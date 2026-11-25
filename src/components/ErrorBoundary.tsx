import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { FirestoreErrorInfo } from '../firebase';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  firestoreInfo: FirestoreErrorInfo | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      message: '',
      firestoreInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let firestoreInfo: FirestoreErrorInfo | null = null;
    try {
      const parsed = JSON.parse(error.message) as FirestoreErrorInfo;
      if (parsed && typeof parsed.operationType === 'string' && 'authInfo' in parsed) {
        firestoreInfo = parsed;
      }
    } catch {
      // Standard runtime error
    }

    return {
      hasError: true,
      message: firestoreInfo
        ? firestoreInfo.error
        : error.message || 'An unexpected error occurred.',
      firestoreInfo,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('YABBAI ErrorBoundary caught error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '', firestoreInfo: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-[#090D16] text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-xl bg-[#0F1624] border border-slate-800 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h1 className="font-display text-lg font-semibold text-slate-50">
                Database or Application Error
              </h1>
              <p className="text-sm text-slate-400 leading-relaxed">
                {this.state.message}
              </p>
            </div>
          </div>

          {this.state.firestoreInfo && (
            <div className="p-3.5 rounded-lg bg-[#090D16] border border-slate-800 font-mono text-xs text-slate-400 space-y-1">
              <div>Operation: {this.state.firestoreInfo.operationType}</div>
              <div>Path: {this.state.firestoreInfo.path ?? 'unknown'}</div>
              <div>
                Signed in: {this.state.firestoreInfo.authInfo.email ?? 'Guest'}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Retry Workspace</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}

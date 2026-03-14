// Stratus Weather System
// Created by Lukas Esterhuizen

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      
      return (
        <div className="flex h-screen w-full flex-col items-center justify-center bg-slate-900 text-white p-8">
          <div className="max-w-2xl text-center">
            <h1 className="text-3xl font-bold mb-4 text-red-400">Something went wrong</h1>
            <div className="bg-slate-800 rounded-lg p-4 text-left mb-4">
              <p className="text-red-300 font-mono text-sm mb-2">
                {this.state.error?.message || 'Unknown error'}
              </p>
              {this.state.errorInfo && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-slate-400 hover:text-slate-300">
                    Stack trace
                  </summary>
                  <pre className="mt-2 text-xs text-slate-500 overflow-auto max-h-64">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

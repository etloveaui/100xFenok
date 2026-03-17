"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type TileBoundaryProps = {
  tileKey: string;
  children: ReactNode;
};

type TileBoundaryState = {
  hasError: boolean;
};

export default class TileBoundary extends Component<TileBoundaryProps, TileBoundaryState> {
  constructor(props: TileBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): TileBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[TileBoundary] ${this.props.tileKey} crashed:`, error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[138px] items-center justify-center rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
          <p className="text-center text-sm font-semibold text-slate-500">
            일시적 오류
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

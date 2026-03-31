'use client';

import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          fontFamily: 'Inter, system-ui, sans-serif',
          color: 'var(--text-primary, #18181b)',
          backgroundColor: 'var(--bg-primary, #f8fafc)',
        }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            出现了一些问题
          </h1>
          <p style={{ color: 'var(--text-secondary, #71717a)', marginBottom: '1.5rem', textAlign: 'center' }}>
            应用遇到了意外错误，请尝试刷新页面。
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1.5rem',
              borderRadius: '0.5rem',
              border: 'none',
              backgroundColor: 'var(--primary, #2563eb)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            刷新页面
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

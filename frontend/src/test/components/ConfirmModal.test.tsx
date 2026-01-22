import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmModal } from '../../components/ConfirmModal';

describe('ConfirmModal', () => {
  const defaultProps = {
    title: 'Confirm Action',
    message: 'Are you sure you want to proceed?',
    confirmLabel: 'Yes',
    cancelLabel: 'No',
    onConfirm: vi.fn(),
    onCancel: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title', () => {
    render(<ConfirmModal {...defaultProps} />);
    expect(screen.getByText('Confirm Action')).toBeInTheDocument();
  });

  it('renders message as string', () => {
    render(<ConfirmModal {...defaultProps} />);
    expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
  });

  it('renders message as ReactNode', () => {
    render(
      <ConfirmModal 
        {...defaultProps} 
        message={<span data-testid="custom-message">Custom message</span>} 
      />
    );
    expect(screen.getByTestId('custom-message')).toBeInTheDocument();
  });

  it('renders confirm and cancel buttons', () => {
    render(<ConfirmModal {...defaultProps} />);
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    render(<ConfirmModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Yes'));
    expect(defaultProps.onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', () => {
    render(<ConfirmModal {...defaultProps} />);
    fireEvent.click(screen.getByText('No'));
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when close button is clicked', () => {
    render(<ConfirmModal {...defaultProps} />);
    fireEvent.click(screen.getByText('×'));
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when overlay is clicked', () => {
    const { container } = render(<ConfirmModal {...defaultProps} />);
    const overlay = container.querySelector('.modal-overlay');
    fireEvent.click(overlay!);
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });

  it('does not call onCancel when modal content is clicked', () => {
    const { container } = render(<ConfirmModal {...defaultProps} />);
    const content = container.querySelector('.modal-content');
    fireEvent.click(content!);
    expect(defaultProps.onCancel).not.toHaveBeenCalled();
  });

  it('disables buttons when loading', () => {
    render(<ConfirmModal {...defaultProps} isLoading={true} />);
    expect(screen.getByText('Yes')).toBeDisabled();
    expect(screen.getByText('No')).toBeDisabled();
  });

  it('applies primary variant by default', () => {
    render(<ConfirmModal {...defaultProps} />);
    const confirmBtn = screen.getByText('Yes');
    expect(confirmBtn.className).toContain('primary');
  });

  it('applies danger variant when specified', () => {
    render(<ConfirmModal {...defaultProps} confirmVariant="danger" />);
    const confirmBtn = screen.getByText('Yes');
    expect(confirmBtn.className).toContain('danger');
  });

  it('applies success variant when specified', () => {
    render(<ConfirmModal {...defaultProps} confirmVariant="success" />);
    const confirmBtn = screen.getByText('Yes');
    expect(confirmBtn.className).toContain('success');
  });
});

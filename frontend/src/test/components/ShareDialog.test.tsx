import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShareDialog } from '../../components/ShareDialog';

describe('ShareDialog', () => {
  const defaultProps = {
    show: true,
    sharePeople: ['Alice', 'Bob'],
    shareSelectedPerson: 'Alice',
    onShareSelectedPersonChange: vi.fn(),
    shareSelectedDays: 30,
    onShareSelectedDaysChange: vi.fn(),
    shareGenerating: false,
    shareLink: null,
    onShareLinkChange: vi.fn(),
    shareCopied: false,
    onShareCopiedChange: vi.fn(),
    onClose: vi.fn(),
    onGenerateShareLink: vi.fn(),
    onCopyShareLink: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when show is false', () => {
    const { container } = render(<ShareDialog {...defaultProps} show={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog when show is true', () => {
    render(<ShareDialog {...defaultProps} />);
    expect(screen.getByText(/share\.title/i)).toBeInTheDocument();
  });

  it('renders no people message when sharePeople is empty', () => {
    render(<ShareDialog {...defaultProps} sharePeople={[]} />);
    expect(screen.getByText(/share\.noPeople/i)).toBeInTheDocument();
  });

  it('renders person selection dropdown', () => {
    render(<ShareDialog {...defaultProps} />);
    expect(screen.getByRole('option', { name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Bob' })).toBeInTheDocument();
  });

  it('renders period selection dropdown', () => {
    render(<ShareDialog {...defaultProps} />);
    // The dropdown renders with 3 options for time periods
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThanOrEqual(3);
  });

  it('calls onClose when close button is clicked', () => {
    render(<ShareDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('×'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onClose when overlay is clicked', () => {
    const { container } = render(<ShareDialog {...defaultProps} />);
    const overlay = container.querySelector('.modal-overlay');
    fireEvent.click(overlay!);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows generated link', () => {
    render(<ShareDialog {...defaultProps} shareLink="http://example.com/share/abc123" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('http://example.com/share/abc123');
  });

  it('calls onCopyShareLink when copy button is clicked', () => {
    render(<ShareDialog {...defaultProps} shareLink="http://example.com/share/abc123" />);
    fireEvent.click(screen.getByText('📋'));
    expect(defaultProps.onCopyShareLink).toHaveBeenCalled();
  });

  it('shows copied indicator after copy', () => {
    render(<ShareDialog {...defaultProps} shareLink="http://example.com/share/abc123" shareCopied={true} />);
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('selects link text when input is clicked', () => {
    render(<ShareDialog {...defaultProps} shareLink="http://example.com/share/abc123" />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    const selectMock = vi.fn();
    input.select = selectMock;
    fireEvent.click(input);
    expect(selectMock).toHaveBeenCalled();
  });
});

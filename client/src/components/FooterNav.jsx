import Button from './Button.jsx';

/**
 * Props:
 *   onBack?:    () => void   (hides Back if absent)
 *   onNext?:    () => void
 *   nextLabel?: string       (default "Continue")
 *   meta?:      ReactNode    (center text)
 */
export default function FooterNav({ onBack, onNext, nextLabel = 'Continue', meta }) {
  return (
    <footer className="footer-nav">
      <div>
        {onBack && <Button variant="ghost" onClick={onBack}>← Back</Button>}
      </div>
      <div className="footer-meta">
        {meta || <>Latitude · <em>a walking agenda</em> · v0.1</>}
      </div>
      <div className="footer-right">
        {onNext && <Button onClick={onNext} arrow>{nextLabel}</Button>}
      </div>
    </footer>
  );
}

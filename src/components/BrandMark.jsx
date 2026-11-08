export default function BrandMark({ compact = false }) {
  return (
    <a className={`brand-lockup${compact ? " brand-lockup-compact" : ""}`} href="/">
      <span className="brand-symbol" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M12.5 10 7 16l5.5 6M19.5 10 25 16l-5.5 6M18 7l-4 18" />
        </svg>
      </span>
      <span className="brand-wordmark">Code<span>Room</span></span>
    </a>
  );
}

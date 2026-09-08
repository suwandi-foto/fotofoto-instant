/** The FOTOFOTO wordmark, matching fotofoto.asia's two-tone treatment. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-bold ${className}`}>
      <span className="text-text">FOTO</span>
      <span className="text-gold">FOTO</span>
    </span>
  );
}

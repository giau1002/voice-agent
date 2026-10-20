export function AssistantAvatar({ className = '' }: { className?: string }) {
  return <span className={`assistant-avatar ${className}`} aria-hidden="true">
    <img src="/avatar/portrait.png" alt="" />
  </span>;
}

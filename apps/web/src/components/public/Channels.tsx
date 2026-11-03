'use client';
import NextLink from 'next/link';

type TawkWindow = Window & { Tawk_API?: { maximize?: () => void } };

/** "Open chat": opens the live-chat widget (D-16) when it is loaded, otherwise falls back to the contact form. */
function OpenChat({ label }: { label: string }) {
  return (
    <a
      href="/about#contact"
      onClick={(e) => {
        const tawk = (window as TawkWindow).Tawk_API;
        if (tawk?.maximize) {
          e.preventDefault();
          tawk.maximize();
        }
      }}
      className="channel-action"
    >
      {label}
    </a>
  );
}

export interface Channel {
  title: string;
  description: string;
  action: string;
  /** 'chat' opens the live-chat widget; otherwise an internal path or external URL. */
  href: string | 'chat';
}

/** Channel row (Doc 02 §5.47.23): 360×80 tile, title Label/MD, description Body/SM, action link right. */
export function ChannelList({ channels, className }: { channels: Channel[]; className?: string }) {
  return (
    <ul data-reveal-group className={`space-y-4 ${className ?? ''}`}>
      {channels.map((c) => (
        <li
          data-reveal-item
          key={c.title}
          className="relative flex min-h-20 items-center justify-between gap-4 rounded-lg bg-subtle px-4 py-3 transition-colors hover:bg-brand-subtle [&_.channel-action]:shrink-0 [&_.channel-action]:rounded-sm [&_.channel-action]:text-label-sm [&_.channel-action]:font-semibold [&_.channel-action]:text-fg-brand [&_.channel-action]:after:absolute [&_.channel-action]:after:inset-0 [&_.channel-action]:after:rounded-lg [&_.channel-action]:focus-visible:outline-none [&_.channel-action:focus-visible]:after:shadow-focus"
        >
          <div className="min-w-0">
            <p className="text-label-md text-fg">{c.title}</p>
            <p className="mt-0.5 truncate text-body-xs text-fg-tertiary">{c.description}</p>
          </div>
          {c.href === 'chat' ? (
            <OpenChat label={c.action} />
          ) : c.href.startsWith('/') ? (
            <NextLink href={c.href} className="channel-action">
              {c.action}
            </NextLink>
          ) : (
            <a href={c.href} target="_blank" rel="noopener noreferrer" className="channel-action">
              {c.action}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

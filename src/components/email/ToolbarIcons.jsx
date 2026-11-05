// Glyphs for the email template editor's toolbar (16px, stroke = currentColor).

const Svg = ({ children }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export const UndoIcon = () => <Svg><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Svg>
export const RedoIcon = () => <Svg><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></Svg>
export const BoldIcon = () => <Svg><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z" /><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z" /></Svg>
export const ItalicIcon = () => <Svg><line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" /></Svg>
export const UnderlineIcon = () => <Svg><path d="M6 4v6a6 6 0 0 0 12 0V4" /><line x1="4" y1="20" x2="20" y2="20" /></Svg>
export const StrikeIcon = () => <Svg><path d="M16 6.5C15.2 5 13.7 4 12 4c-2.5 0-4 1.4-4 3.2 0 1.2.6 2 1.8 2.6" /><line x1="4" y1="12" x2="20" y2="12" /><path d="M8 17.5c.8 1.5 2.3 2.5 4 2.5 2.5 0 4-1.4 4-3.2 0-.6-.1-1.1-.4-1.6" /></Svg>
export const TextColorIcon = ({ color }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
    <path d="M6 16 12 4l6 12M8.2 12h7.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="4" y="19" width="16" height="3" rx="1.5" fill={color} />
  </svg>
)
export const HighlightIcon = ({ color }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
    <path d="m9 11-4 4v2h4l4-4M9 11l5.5-5.5a2.1 2.1 0 0 1 3 3L12 14z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="4" y="19" width="16" height="3" rx="1.5" fill={color} />
  </svg>
)
export const AlignLeftIcon = () => <Svg><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="14" y2="12" /><line x1="4" y1="18" x2="18" y2="18" /></Svg>
export const AlignCenterIcon = () => <Svg><line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="5" y1="18" x2="19" y2="18" /></Svg>
export const AlignRightIcon = () => <Svg><line x1="4" y1="6" x2="20" y2="6" /><line x1="10" y1="12" x2="20" y2="12" /><line x1="6" y1="18" x2="20" y2="18" /></Svg>
export const BulletsIcon = () => <Svg><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><circle cx="4.5" cy="6" r="1" fill="currentColor" /><circle cx="4.5" cy="12" r="1" fill="currentColor" /><circle cx="4.5" cy="18" r="1" fill="currentColor" /></Svg>
export const NumbersIcon = () => <Svg><line x1="10" y1="6" x2="20" y2="6" /><line x1="10" y1="12" x2="20" y2="12" /><line x1="10" y1="18" x2="20" y2="18" /><path d="M4 4.5h1.5V9M4 9h3" /><path d="M4 14.5c.4-.6 1-.9 1.6-.9.8 0 1.4.5 1.4 1.2 0 1.2-3 2-3 3.7h3" /></Svg>
export const LinkIcon = () => <Svg><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></Svg>
export const UnlinkIcon = () => <Svg><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /><line x1="4" y1="4" x2="20" y2="20" /></Svg>
export const ImageIcon = () => <Svg><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="m21 16-5-5-9 9" /></Svg>
export const ClearIcon = () => <Svg><path d="M5 5h11M10.5 5 8 19" /><line x1="14" y1="14" x2="20" y2="20" /><line x1="20" y1="14" x2="14" y2="20" /></Svg>
export const ChevronIcon = () => <Svg><path d="m6 9 6 6 6-6" /></Svg>
export const TrashIcon = () => <Svg><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></Svg>

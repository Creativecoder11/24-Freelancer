import {
  ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Banknote, Bell, Briefcase, Building2, Calendar, ChartColumn,
  Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, CircleAlert, CircleCheck, CircleHelp, CirclePlus,
  CircleX, Clipboard, Clock, Coins, Copy, CreditCard, Download, Ellipsis, ExternalLink, Eye, EyeOff, FileText, Flag,
  Gift, Globe, GripVertical, Image, Inbox, Info, Keyboard, Layers, LayoutDashboard, LayoutGrid, LifeBuoy, Link,
  ListChecks, LoaderCircle, Lock, LogOut, Mail, MapPin, Megaphone, Menu, MessageSquare, Minus, Monitor, Pause,
  PenLine, Percent, Phone, Play, Plus, RefreshCw, RotateCcw, Search, Send, Settings, Share2, ShieldCheck,
  SlidersHorizontal, Sparkle, SquarePen, Star, Tag, Target, ThumbsUp, Trash2, TrendingDown, TrendingUp, TriangleAlert,
  Upload, User, Users, Wallet, X, Zap, type LucideIcon,
} from 'lucide-react';

/** Figma icon names (page 4:2) → Lucide (Doc 02 §4.10). */
export const ICONS = {
  search: Search, bell: Bell, dashboard: LayoutDashboard, briefcase: Briefcase, 'list-checks': ListChecks,
  wallet: Wallet, gift: Gift, users: Users, user: User, settings: Settings, 'plus-circle': CirclePlus, plus: Plus,
  layers: Layers, inbox: Inbox, check: Check, 'check-circle': CircleCheck, x: X, 'x-circle': CircleX,
  'alert-circle': CircleAlert, 'alert-triangle': TriangleAlert, info: Info, clock: Clock, 'arrow-right': ArrowRight,
  'arrow-left': ArrowLeft, 'arrow-up-right': ArrowUpRight, 'arrow-down-left': ArrowDownLeft,
  'chevron-down': ChevronDown, 'chevron-up': ChevronUp, 'chevron-right': ChevronRight, 'chevron-left': ChevronLeft,
  upload: Upload, download: Download, image: Image, link: Link, copy: Copy, eye: Eye, 'eye-off': EyeOff, lock: Lock,
  mail: Mail, phone: Phone, 'shield-check': ShieldCheck, support: LifeBuoy, message: MessageSquare, 'log-out': LogOut,
  filter: SlidersHorizontal, 'trending-up': TrendingUp, 'trending-down': TrendingDown, 'bar-chart': ChartColumn,
  'file-text': FileText, globe: Globe, edit: SquarePen, trash: Trash2, pause: Pause, play: Play, more: Ellipsis,
  'more-horizontal': Ellipsis, menu: Menu, star: Star, flag: Flag, 'credit-card': CreditCard, banknote: Banknote,
  refresh: RefreshCw, calendar: Calendar, target: Target, zap: Zap, 'external-link': ExternalLink, share: Share2,
  help: CircleHelp, 'map-pin': MapPin, tag: Tag, monitor: Monitor, keyboard: Keyboard, clipboard: Clipboard,
  megaphone: Megaphone, pen: PenLine, percent: Percent, loader: LoaderCircle, grid: LayoutGrid, send: Send,
  rotate: RotateCcw, coins: Coins, building: Building2, sparkle: Sparkle, 'thumbs-up': ThumbsUp,
  'grip-vertical': GripVertical, minus: Minus, circle: Circle,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  size?: 12 | 14 | 16 | 20 | 24;
  className?: string;
  strokeWidth?: number;
  /** When set the icon is announced; otherwise aria-hidden. */
  label?: string;
}

export function Icon({ name, size = 20, className, strokeWidth = 2, label }: IconProps) {
  const C = ICONS[name];
  return (
    <C
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable={false}
    />
  );
}

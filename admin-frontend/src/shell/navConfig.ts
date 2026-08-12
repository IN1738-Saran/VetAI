import {
  LayoutDashboard,
  CalendarClock,
  Users,
  Sparkles,
  Briefcase,
  BarChart3,
  Mail,
  FileText,
  Building2,
  UserCircle,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  section: 'main' | 'settings';
  /**
   * Screens with no reference image at all (Email Center, Reports,
   * Organization, Profile) and AI Assistant (has a reference image, but is
   * explicitly scoped as a nav stub only — see implementation plan §4.4 /
   * master prompt "Out of scope") render as disabled "coming soon" entries.
   */
  disabled?: boolean;
  /** Live badge count — wired to the real feed starting Phase 3; static for now. */
  badge?: number;
}

// Mirrors the sidebar observed identically across all 7 reference screenshots:
// MAIN (8 items) + SETTINGS (2 items) = 10 nav destinations. The original
// implementation plan undercounted this as "8 destinations" - corrected here.
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, section: 'main' },
  { label: 'Interviews', path: '/interviews', icon: CalendarClock, section: 'main' },
  { label: 'Candidates', path: '/candidates', icon: Users, section: 'main' },
  { label: 'AI Assistant', path: '/ai-assistant', icon: Sparkles, section: 'main', disabled: true },
  { label: 'Job Library', path: '/job-library', icon: Briefcase, section: 'main' },
  { label: 'Analytics', path: '/analytics', icon: BarChart3, section: 'main' },
  { label: 'Email Center', path: '/email-center', icon: Mail, section: 'main', disabled: true },
  { label: 'Reports', path: '/reports', icon: FileText, section: 'main', disabled: true },
  { label: 'Organization', path: '/organization', icon: Building2, section: 'settings', disabled: true },
  { label: 'Profile', path: '/profile', icon: UserCircle, section: 'settings', disabled: true },
];

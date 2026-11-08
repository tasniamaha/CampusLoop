import SectionTabs from '../SectionTabs';

const TABS = [
  { href: '/lost-found', label: 'Reports' },
  { href: '/lost-found/new', label: 'Report an item' },
  { href: '/lost-found/mine', label: 'My reports' },
] as const;

/** Lost-and-found section menu. Behaviour lives in SectionTabs. */
export default function LostFoundTabs() {
  return <SectionTabs label="Lost and found" tabs={TABS} />;
}

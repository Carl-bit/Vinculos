import { LayoutPublico } from '@/components/shared/LayoutPublico';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <LayoutPublico>{children}</LayoutPublico>;
}

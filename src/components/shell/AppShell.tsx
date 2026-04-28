import { TopBar } from './TopBar';
import { LeftRail } from './LeftRail';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rv">
      <TopBar />
      <div className="rv-body">
        <LeftRail />
        <div className="rv-content">{children}</div>
      </div>
    </div>
  );
}

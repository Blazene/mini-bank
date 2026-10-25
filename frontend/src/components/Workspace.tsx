import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom';
import { useState, type MouseEvent } from 'react';
import {
  ArrowLeftRight,
  ArrowUpRight,
  ChevronRight,
  CircleHelp,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { BankProvider, useBank } from '../context/Bank';
import { useSession } from '../context/Session';
import { Brand, Dialog } from './ui';
const links = [
  { path: 'overview', label: 'Overview', icon: LayoutDashboard },
  { path: 'accounts', label: 'Accounts', icon: WalletCards },
  { path: 'payments', label: 'Move money', icon: ArrowLeftRight },
  { path: 'activity', label: 'Activity', icon: FileText },
  { path: 'loans', label: 'Loans', icon: FileText },
];
function Frame() {
  const { user, preview, prefix, navigationLocked } = useBank(),
    { logout } = useSession(),
    navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const initials = user.fullName
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  function guardNavigation(event: MouseEvent) {
    if (
      navigationLocked &&
      !window.confirm(
        'A write is in progress or unconfirmed. Leaving discards its saved retry request. Check activity before starting it again. Leave this page?'
      )
    )
      event.preventDefault();
  }
  const navigation = (
    <>
      <Link
        to={`${prefix}/overview`}
        className="brand-link"
        aria-label="Mini Bank overview"
        onClick={guardNavigation}
      >
        <Brand light />
      </Link>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav aria-label="Main navigation">
        {links.map(({ path, label, icon: Icon }) => (
          <NavLink
            to={`${prefix}/${path}`}
            key={path}
            onClick={(event) => {
              guardNavigation(event);
              if (!event.defaultPrevented) setMenu(false);
            }}
          >
            <Icon size={20} strokeWidth={1.7} />
            <span>{label}</span>
            <ChevronRight size={15} className="nav-chevron" />
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note">
          <ShieldCheck size={24} />
          <strong>Designed with care.</strong>
          <p>A clearer way to explore your finances.</p>
        </div>
        <a
          href="https://mini-bank-api-2bxt.onrender.com/api/v1/docs/"
          target="_blank"
          rel="noreferrer"
          className="support-link"
        >
          <CircleHelp size={19} /> API & help <ArrowUpRight size={15} />
        </a>
        <button
          className="profile-button"
          disabled={navigationLocked}
          title={navigationLocked ? 'Resolve the pending write before signing out.' : undefined}
          onClick={() => {
            logout();
            navigate('/login');
          }}
        >
          <span className="avatar">{initials}</span>
          <span>
            <strong>{user.fullName}</strong>
            <small>{preview ? 'Exit preview workspace' : 'Sign out of this session'}</small>
          </span>
          <LogOut size={18} />
        </button>
      </div>
    </>
  );
  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">{navigation}</aside>
      {menu && (
        <Dialog title="Your workspace" onClose={() => setMenu(false)}>
          <div className="mobile-nav">{navigation}</div>
        </Dialog>
      )}
      <div className="workspace-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={23} />
            </button>
            <span className="topbar-title">
              Personal banking <ChevronRight size={14} />
              <span>Your workspace</span>
            </span>
          </div>
          <div className="topbar-right">
            <span className="environment-pill">
              <span />
              {preview ? 'Preview workspace' : 'Educational demo'}
            </span>
            <span className="avatar avatar-light" aria-label={user.fullName}>
              {initials}
            </span>
          </div>
        </header>
        {preview && (
          <div className="preview-banner">
            <span>
              <strong>A little look around.</strong> You’re viewing sample data. No transactions
              will be sent.
            </span>
            <Link to="/login">
              Use the live workspace <ArrowUpRight size={14} />
            </Link>
          </div>
        )}
        <main id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>
            <ShieldCheck size={14} /> Mini Bank · Educational demonstration
          </span>
          <span>No real funds, payment rails or loan disbursement.</span>
        </footer>
      </div>
    </div>
  );
}
export function Workspace() {
  return (
    <BankProvider>
      <Frame />
    </BankProvider>
  );
}

import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import Login from './pages/Login';
import Schedules from './pages/Schedules';
import ScheduleDetail from './pages/ScheduleDetail';
import MyShifts from './pages/MyShifts';
import Availability from './pages/Availability';
import Staff from './pages/Staff';

// Gate in front of everything that needs an account. While the stored token
// is still being checked it renders nothing, rather than bouncing you to the
// login screen and back on every refresh.
function Protected({ children }) {
  const { status } = useAuth();
  if (status === 'checking') return <p className="muted center">Checking your session...</p>;
  if (status !== 'signed-in') return <Navigate to="/login" replace />;
  return children;
}

// Already signed in? The login page has nothing to offer you.
function LoginRoute() {
  const { status } = useAuth();
  if (status === 'checking') return <p className="muted center">Checking your session...</p>;
  if (status === 'signed-in') return <Navigate to="/" replace />;
  return <Login />;
}

function ManagerOnly({ children }) {
  const { isManager } = useAuth();
  if (!isManager) return <p className="alert">Managers only.</p>;
  return children;
}

function Shell({ children }) {
  const { user, signOut, isManager } = useAuth();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__inner">
          <span className="brand">Shift<span>Roster</span></span>

          <nav className="nav">
            <NavLink to="/" end>Schedules</NavLink>
            <NavLink to="/my-shifts">My shifts</NavLink>
            <NavLink to="/availability">Availability</NavLink>
            {isManager && <NavLink to="/staff">Team</NavLink>}
          </nav>

          <div className="who">
            <span className="muted small">{user.name}</span>
            <span className={'pill' + (isManager ? ' pill--good' : '')}>{user.role}</span>
            <button className="btn btn--ghost btn--sm" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </header>

      <main className="page">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/*"
            element={
              <Protected>
                <Shell>
                  <Routes>
                    <Route path="/" element={<Schedules />} />
                    <Route path="/schedules/:id" element={<ScheduleDetail />} />
                    <Route path="/my-shifts" element={<MyShifts />} />
                    <Route path="/availability" element={<Availability />} />
                    <Route path="/staff" element={<ManagerOnly><Staff /></ManagerOnly>} />
                    <Route path="*" element={<p className="muted">Nothing here.</p>} />
                  </Routes>
                </Shell>
              </Protected>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

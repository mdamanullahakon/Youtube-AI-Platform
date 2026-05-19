import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <h1 className="text-7xl font-bold gradient-text">404</h1>
        <p className="text-xl text-muted">Page not found</p>
        <p className="text-sm text-muted max-w-md">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link href="/dashboard" className="btn-primary inline-block mt-4">
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}

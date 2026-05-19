'use client';

import { useEffect } from 'react';

const SECURITY_MESSAGE = [
  '⚠️ Security Warning',
  '',
  'This is a browser feature intended for developers.',
  '',
  'If someone told you to copy-paste something here to enable',
  'a feature, "hack" an account, or win a prize, it is a scam.',
  'Pasting malicious scripts here can compromise your account.',
  '',
  'See: https://en.wikipedia.org/wiki/Self-XSS',
].join('\n');

export function ConsoleGuard({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    console.log(
      `%c${SECURITY_MESSAGE}`,
      'font-size:14px; color:#ef4444; line-height:1.6; font-weight:bold;'
    );
  }, []);

  return <>{children}</>;
}

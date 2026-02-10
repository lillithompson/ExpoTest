import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Root HTML for web. Ensures color-scheme is light so dialogs and browser UI
 * (e.g. on mobile web in device dark mode) use light styling.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="color-scheme" content="light" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}

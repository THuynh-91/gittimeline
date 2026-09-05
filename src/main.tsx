import { render } from 'preact';
import { App } from './app/App';
import { initAnalytics } from './app/analytics';
import './app/styles.css';

// Before anything renders, so the first page view is not lost. It is a no-op
// unless `VITE_GA_ID` is set and the visitor has not asked not to be measured;
// see `app/analytics.ts` for what may and may not be sent.
initAnalytics();

render(<App />, document.getElementById('app')!);

import { render } from 'preact';
import '../ui/theme.css';
import './panel.css';
import { App } from './App.tsx';
import { startSnapshotFeed } from '../ui/useSnapshot.ts';

startSnapshotFeed();
render(<App />, document.getElementById('root')!);

import { render } from 'preact';
import { AuthGate } from './ui/AuthGate';
import './styles.css';

render(<AuthGate />, document.getElementById('app')!);

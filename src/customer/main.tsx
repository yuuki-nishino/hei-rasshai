import { render } from 'preact';
import '../styles/tokens.css';
import '../styles/base.css';
import './customer.css';
import { CustomerApp } from './CustomerApp';

render(<CustomerApp />, document.getElementById('app')!);

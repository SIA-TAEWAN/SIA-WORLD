import './style.css';
import { nav } from './ui/app';
import { showEntry, showSetup } from './ui/offline';
import { showLobby } from './ui/online';

nav.entry = showEntry;
nav.setup = showSetup;
nav.lobby = showLobby;

showEntry();

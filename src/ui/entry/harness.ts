// Dev-only: `npx vite`, then open /entry-harness.html. Not part of the build input.
import { mount } from 'svelte';
import '../fonts.css';
import '../theme.css';
import Harness from './Harness.svelte';

mount(Harness, { target: document.getElementById('app')! });

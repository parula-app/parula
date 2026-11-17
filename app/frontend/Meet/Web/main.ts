import { mount } from 'svelte';
import MeetWeb from './MeetWeb.svelte';
import '../../app.css';
import { appGlobal } from '../../../logic/app';
import { Person } from '../../../logic/Abstract/Person';

appGlobal.me = new Person(); // this build has no `startup()`

const app = mount(MeetWeb, {
  target: document.getElementById('app'),
});

export default app;

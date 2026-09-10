import {create} from 'zustand';
type Page='Dashboard'|'Vacancies'|'Applications'|'Messages'|'Interviews'|'Analytics'|'Profile'|'Settings';
export const useUI=create<{page:Page;setPage:(page:Page)=>void;compact:boolean;toggleCompact:()=>void}>((set)=>({page:'Interviews',setPage:(page)=>set({page}),compact:false,toggleCompact:()=>set(s=>({compact:!s.compact}))}));

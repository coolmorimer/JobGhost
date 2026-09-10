import {BriefcaseBusiness,Building2,CircleUserRound,LayoutDashboard,Mic2,Settings} from 'lucide-react';
import {useUI} from './stores/ui';
import {Dashboard} from './pages/Dashboard';
import {Vacancies} from './pages/Vacancies';
import {Applications} from './pages/Applications';
import {Interview} from './pages/Interview';
import {Profile} from './pages/Profile';
import {DesktopHotkeys} from './components/DesktopHotkeys';
import {DesktopControls} from './components/DesktopControls';
import {useState} from 'react';
const nav=[['Interviews','Помощник',Mic2],['Dashboard','Обзор',LayoutDashboard],['Vacancies','Вакансии',Building2],['Applications','Отклики и письма',BriefcaseBusiness],['Profile','Мой профиль',CircleUserRound],['Settings','Настройки и помощь',Settings]] as const;
export default function App(){
  const {page,setPage}=useUI();
  const [menuOpen,setMenuOpen]=useState(false);
  const content=page==='Dashboard'?<Dashboard/>:page==='Vacancies'?<Vacancies/>:page==='Applications'?<Applications/>:page==='Profile'?<Profile/>:<><header><div><h1>Настройки и помощь</h1><p>Как включить помощника и управлять им во время разговора.</p></div></header><section className="panel"><h2>Как начать</h2><ol><li>В разделе «Помощник» проверьте автоматическое подключение ChatGPT.</li><li>Выберите резюме — его данные станут ролью помощника на текущем интервью.</li><li>Выберите экран со звуком собеседника. Микрофон включайте, если нужно распознавать и ваш голос.</li><li>Задайте вопрос, нажмите Ctrl+Enter для последней распознанной фразы или включите автоматическую отправку вопросов.</li></ol><h2>Управление окном</h2><p>Скрытый режим убирает окно с экрана и панели задач, но не выключает захват. Значка возле часов нет.</p><p>Ctrl+Shift+Space — скрыть или показать. Фактическое сочетание отправки вопроса указано ниже. Ctrl+Alt+S — сделать снимок. Ctrl+Alt+X — остановить захват.</p><DesktopHotkeys/><h2>Отклики на HH</h2><p>JobGhost работает через ваш браузер без API HH. Перед реальной отправкой можно включить проверку вакансии и подтверждение отклика.</p></section></>;
  return <div className={`shell ${page==='Interviews'?'assistant-shell':''}`}><aside id="app-navigation" hidden={page==='Interviews'&&!menuOpen}><div className="brand"><div>JG</div><span><b>JobGhost</b><small>Ваш помощник для работы</small></span></div><nav aria-label="Главное меню">{nav.map(([key,label,Icon])=><button className={page===key?'selected':''} onClick={()=>{setPage(key);setMenuOpen(false);}} key={key}><Icon/>{label}</button>)}</nav><div className="dry"><b>Безопасные автоотклики HH</b><span>Сначала проверка вакансии и письма.<br/>Отправку можно подтверждать вручную.</span></div></aside><main>{page==='Interviews'?<div className="assistant-topline"><b>JobGhost</b><button className="ghost" aria-expanded={menuOpen} aria-controls="app-navigation" onClick={()=>setMenuOpen(!menuOpen)}>{menuOpen?'Закрыть меню':'Разделы'}</button>{window.jobghostDesktop?.hide&&<button className="ghost" onClick={()=>void window.jobghostDesktop?.hide?.()}>Скрыть окно</button>}</div>:<DesktopControls/>}<div hidden={page!=='Interviews'}><Interview/></div>{page!=='Interviews' && content}</main></div>;
}

import {useState} from 'react';

export function ChatPairing() {
  const [notice,setNotice]=useState('');
  async function perform(action:()=>Promise<unknown>){
    try{await action();}
    catch(e){setNotice(e instanceof Error?e.message:'Не удалось выполнить действие');}
  }
  return <section className="panel" aria-label="Подключение ChatGPT">
    <h2>ChatGPT подключается сам</h2>
    <p>API-ключ, код и отдельная кнопка подключения не нужны. JobGhost сам открывает служебный чат в Google Chrome и скрывает его с экрана и из Alt+Tab.</p>
    <div className="pairing-steps">
      <div className="pairing-step">
        <h3>1. Расширение — один раз</h3>
        <p>Если JobGhost уже есть на странице расширений Chrome, ничего устанавливать заново не нужно. После обновления нажмите у него «Перезагрузить».</p>
        <details><summary>Первая установка</summary><p>В Google Chrome откройте chrome://extensions, включите режим разработчика, нажмите «Загрузить распакованное» и выберите папку JobGhost. Chrome не разрешает приложению устанавливать расширение скрытно.</p>
        {window.jobghostDesktop?.openExtensionFolder?<button className="secondary" onClick={()=>void perform(async()=>{const folder=await window.jobghostDesktop!.openExtensionFolder!();setNotice('Выберите эту папку: '+folder);})}>Показать папку расширения</button>:<p>Для рабочей копии выберите папку browser-extension в каталоге JobGhost.</p>}</details>
      </div>
      <div className="pairing-step">
        <h3>2. Вход — только когда сессия закончилась</h3>
        <p>Если аккаунт ChatGPT уже открыт в Chrome, ничего делать не нужно. JobGhost покажет служебное окно только для ручного входа и снова спрячет после подключения.</p>
        {window.jobghostDesktop?.openChat?<button onClick={()=>void perform(()=>window.jobghostDesktop!.openChat!())}>Открыть ChatGPT для входа</button>:<a href="https://chatgpt.com/" target="_blank" rel="noreferrer">Открыть ChatGPT для входа</a>}
      </div>
      <div className="pairing-step">
        <h3>3. Работайте в JobGhost</h3>
        <p>Состояние проверяется автоматически. Служебного окна нет на экране и в Alt+Tab; вопросы и ответы видны только в простом чате JobGhost.</p>
      </div>
    </div>
    {notice&&<p role="status">{notice}</p>}
  </section>;
}

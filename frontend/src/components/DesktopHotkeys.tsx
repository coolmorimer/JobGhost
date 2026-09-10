import {useQuery} from '@tanstack/react-query';
export function DesktopHotkeys() {
  const state=useQuery({queryKey:['desktop-window'],enabled:!!window.jobghostDesktop,
    queryFn:()=>window.jobghostDesktop!.getState(),refetchInterval:5000});
  if(!window.jobghostDesktop) return <p>Открыта браузерная версия: системные горячие клавиши и изменение размера окна недоступны.</p>;
  return <>
    <p>Поверх окон: {state.data?.alwaysOnTop ? 'включено' : 'выключено'}</p>
    {state.data?.pointerShortcut && <p>Клики насквозь: {state.data.pointerShortcut.replace('Control','Ctrl')}. Удержание Shift также позволяет управлять чатом.</p>}
    {state.data?.askShortcut && <p>Ручная отправка последней распознанной фразы: {state.data.askShortcut.replace('Control','Ctrl')}.</p>}
    <p>Защита окна Windows: {state.data?.overlay?.protected ? 'включена' : 'не подтверждена — перезапустите десктопное приложение'}. Проверка в вашей программе демонстрации всё равно необходима.</p>
    <p>Ctrl+Shift+Space — убрать или вернуть окно. Захват и обработка продолжаются без значка в трее. Ctrl+Alt+X — остановить захват. Полный выход находится в «Основные».</p>
    <p>Перед демонстрацией включите «Скрытый чат поверх окон». Служебное окно ChatGPT откроется и свернётся автоматически. Если вход закончился, один раз войдите снова. Защита JobGhost не скрывает обычные окна браузера, открытые вами вручную.</p>
    {!!state.data?.failedShortcuts.length && <p role="alert">Не удалось зарегистрировать сочетания (возможно, заняты другой программой): {state.data.failedShortcuts.join(', ')}. Используйте кнопки приложения.</p>}
    {state.error && <p role="alert">Десктопная часть недоступна. Перезапустите JobGhost.</p>}
  </>;
}

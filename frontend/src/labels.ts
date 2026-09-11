const statuses:Record<string,string>={FOUND:'Новая',SUITABLE:'Подходит',PREPARED:'Черновик готов',APPLIED:'Отправлен',HR_REPLY:'Ответ работодателя',INTERVIEW:'Собеседование',TEST_TASK:'Тестовое задание',OFFER:'Предложение работы',REJECTED:'Отказ',IGNORED:'Скрыта',DRY_RUN_VALIDATED:'Проверено без отправки',FAILED:'Ошибка',DRAFT:'Черновик'};
statuses.SENDING='Отправляется — не повторяйте';
statuses.NEEDS_REVIEW='Проверьте результат на HH — повтор заблокирован';
export const statusLabel=(value:string)=>statuses[value] || 'Статус не определён';
export const providerLabel=(value:string)=>value==='hh_browser'||value==='hh' ? 'Работа на hh.ru' : value==='mock' ? 'Демонстрационная вакансия' : 'Другой источник';
export const speechLabel=(value?:string)=>({ready:'Готово к распознаванию',loading:'Загружаем модель…',not_loaded:'Нужно загрузить модель',error:'Ошибка загрузки'}[value || ''] || 'Проверяем…');

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, X } from 'lucide-react';
import { courseColors, type Course, type CourseColor, type CourseInput } from './courses';

const colorNames = { green: '松绿色', blue: '湖蓝色', rose: '玫瑰色', amber: '琥珀色' };

export default function CourseDialog({ course, onClose, onSave }: {
  course?: Course; onClose: () => void; onSave: (input: CourseInput) => boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(course?.name ?? '');
  const [description, setDescription] = useState(course?.description ?? '');
  const [tags, setTags] = useState(course?.tags.join('，') ?? '');
  const [color, setColor] = useState<CourseColor>(course?.color ?? 'green');
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError('请填写课程名称。'); return; }
    const cleanTags = [...new Set(tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))];
    if (cleanTags.length > 5 || cleanTags.some(tag => tag.length > 20)) {
      setError('最多添加 5 个标签，每个标签不超过 20 个字。'); return;
    }
    if (!onSave({ name: name.trim(), description: description.trim(), tags: cleanTags, color })) {
      setError('保存失败，请检查浏览器存储是否可用后重试。');
    }
  }
  return <dialog ref={dialog} className="course-dialog" aria-labelledby="dialog-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form onSubmit={submit}>
      <header className="dialog-heading"><div><span className="eyebrow">COURSE REPLAY</span><h2 id="dialog-title">{course ? '编辑课程' : '开始一门新课程'}</h2></div><button type="button" className="icon-button" aria-label="关闭" title="关闭" onClick={onClose}><X size={20} /></button></header>
      <label className="field">课程名称 <span className="required">*</span><input autoFocus required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="例如：数字电路与逻辑设计" /></label>
      <label className="field">课程简介 <span className="optional">选填</span><textarea rows={3} maxLength={500} value={description} onChange={event => setDescription(event.target.value)} placeholder="这门课里，你想理解什么？" /></label>
      <label className="field">标签 <span className="optional">选填，逗号分隔</span><input maxLength={104} value={tags} onChange={event => setTags(event.target.value)} placeholder="例如：专业课，秋季学期" /></label>
      <fieldset className="color-field"><legend>课程颜色</legend><div className="swatches">{courseColors.map(item => <button key={item} type="button" className={`swatch ${item}`} aria-label={colorNames[item]} title={colorNames[item]} aria-pressed={color === item} onClick={() => setColor(item)}>{color === item && <Check size={17} />}</button>)}</div></fieldset>
      <p className="storage-note">仅保存在此浏览器，尚未同步到服务器。</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <footer className="dialog-footer"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" type="submit">{course ? '保存修改' : '创建课程'}</button></footer>
    </form>
  </dialog>;
}

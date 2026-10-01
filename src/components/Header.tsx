import logo from '../assets/avison-young-logo.png';
import type { Survey } from '../types';

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function Header({ survey }: { survey: Survey }) {
  return (
    <header className="header">
      <img className="logo" src={logo} alt="Avison Young" />
      <div className="title-block">
        <div className="title-strong">Rental Market Survey</div>
        <div className="title-main">{survey.title}</div>
        <div className="title-sub">{survey.location}</div>
      </div>
      <div className="asof">As of {formatDate(survey.asOf)}</div>
    </header>
  );
}

import logo from '../assets/avison-young-logo.png';
import type { Survey } from '../types';
import { formatDate } from '../lib/format';

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

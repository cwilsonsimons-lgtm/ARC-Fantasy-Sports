import React from 'react';
import type { CardSet, Player, Team, Variant } from '../sim/types';

interface Props {
  set: CardSet;
  variant: Variant;
  player: Player;
  team: Team;
  serial?: number;
  size?: 'sm' | 'md' | 'lg';
  number?: number;
}

function initials(p: Player) {
  return `${p.first[0]}${p.last[0]}`;
}

/** A helmeted player in team colours, drawn rather than photographed. */
function Figure({ team, player }: { team: Team; player: Player }) {
  const flip = (player.jersey + player.last.length) % 2 === 0;
  return (
    <svg viewBox="0 0 100 100" className="card-figure" aria-hidden="true">
      <g transform={flip ? 'translate(100 0) scale(-1 1)' : undefined}>
        <path d="M4 100 C6 78 22 66 50 65 C78 66 94 78 96 100 Z" fill={team.primary} stroke="rgb(0 0 0 / 0.25)" strokeWidth="1" />
        <path d="M14 84 C18 76 24 72 30 70 M86 84 C82 76 76 72 70 70" stroke={team.secondary} strokeWidth="3" fill="none" />
        <path d="M38 66 Q50 75 62 66" stroke={team.secondary} strokeWidth="3.5" fill="none" />
        <path d="M24 44 C22 24 36 12 54 12 C72 12 82 24 82 38 C82 44 80 48 76 50 L64 52 L62 60 L44 62 C32 60 25 54 24 44 Z" fill={team.primary} stroke="rgb(0 0 0 / 0.3)" strokeWidth="1" />
        <path d="M28 30 C36 17 56 11 74 18" stroke={team.secondary} strokeWidth="4.5" fill="none" strokeLinecap="round" />
        <ellipse cx="42" cy="24" rx="9" ry="4" fill="#fff" opacity="0.28" transform="rotate(-20 42 24)" />
        <path d="M62 35 C70 33 80 33 86 35 L86 58 L64 60 Z" fill="rgb(0 0 0 / 0.45)" />
        <circle cx="46" cy="42" r="4" fill="rgb(0 0 0 / 0.4)" />
        <path d="M63 40 L87 40 M62 48 L87 48 M66 56 L85 56 M86 38 L86 58 M63 40 C61 47 61 53 66 56" stroke="#d5dae0" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      </g>
      <text x="50" y="94" textAnchor="middle" fontSize="21" fontWeight="800" fill={team.secondary} fontFamily="'Big Shoulders Display', 'Arial Narrow', sans-serif">
        {player.jersey}
      </text>
    </svg>
  );
}

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 33 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function CardView({ set, variant, player, team, serial, size = 'md', number }: Props) {
  const isBase = variant.kind === 'base';
  const rookie = player.rookieYear === set.year;
  const tilt = (hash(player.id + set.id) % 7) - 3;
  const style = {
    '--team': team.primary,
    '--team2': team.secondary,
    '--frame': isBase ? 'var(--card-base-frame)' : variant.color,
    '--tilt': `${tilt}deg`,
  } as React.CSSProperties;
  const no = number ?? set.checklist.indexOf(player.id) + 1;
  return (
    <div
      className={`card card-${size} theme-${set.theme} finish-${variant.finish} ${isBase ? 'is-base' : 'is-special'}`}
      style={style}
      role="img"
      aria-label={`${player.first} ${player.last} ${set.year} ${set.name} ${variant.name}${variant.numbered ? ` numbered to ${variant.printRun}` : ''}`}
    >
      <div className="card-frame">
        <div className="card-photo">
          <div className="card-photo-bg" />
          <Figure team={team} player={player} />
          <div className="card-sheen" />
        </div>
        <div className="card-top">
          <span className="card-brand">{set.name}</span>
          {variant.numbered && (
            <span className="card-serial">
              {serial !== undefined ? String(serial).padStart(String(variant.printRun).length, '0') : '##'}/{variant.printRun}
            </span>
          )}
        </div>
        {rookie && <span className="card-rc" title="Rookie card">RC</span>}
        {variant.autographed && (
          <div className="card-auto">
            <span className="card-sig">{player.first} {player.last}</span>
            <span className="card-auto-label">Certified autograph</span>
          </div>
        )}
        <div className="card-nameplate">
          <span className="card-name">
            <span className="card-first">{player.first}</span> <span className="card-last">{player.last}</span>
          </span>
          <span className="card-meta">
            {team.city} {team.name} · {player.pos}
          </span>
        </div>
        {!isBase && <span className="card-variant">{variant.name}</span>}
        <span className="card-no">#{no > 0 ? no : initials(player)}</span>
      </div>
    </div>
  );
}

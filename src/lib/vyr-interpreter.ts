import type { VYRState, PillarScore } from './vyr-engine';
import { getLimitingFactor } from './vyr-engine';

export interface Interpretation {
  stateLabel: string;
  contextItems: { text: string; status: 'favorable' | 'attention' | 'limiting' }[];
  cognitiveWindow: string;
  systemReading: string;
  whyScore: string;
  dayRisk: string;
  limitingFactorText: string;
  systemReadingType: 'insight' | 'warning' | 'positive';
  todayMeans: string[];
  systemDiagnosis: string;
  pillarDescriptions: Record<string, string>;
}

const pillarNames: Record<string, string> = {
  energia: 'Energia',
  clareza: 'Clareza',
  estabilidade: 'Estabilidade',
};

// --- Helpers ---

function getPillarStatus(value: number): 'favorable' | 'attention' | 'limiting' {
  if (value >= 3.8) return 'favorable';
  if (value >= 2.5) return 'attention';
  return 'limiting';
}

function getPhaseLabel(phase: string): string {
  if (phase === 'BOOT') return 'manhã';
  if (phase === 'HOLD') return 'tarde';
  return 'noite';
}

// --- Contexto do Dia (5 faixas + fase atual) ---

function getPillarContextText(name: string, value: number, phase: string): string {
  const periodo = getPhaseLabel(phase);
  if (value >= 4.5) return `${name} elevada e disponível para demandas intensas nesta ${periodo}.`;
  if (value >= 3.8) return `${name} preservada e funcional para a ${periodo}.`;
  if (value >= 3.0) return `${name} moderada — atenção recomendada durante a ${periodo}.`;
  if (value >= 2.0) return `${name} reduzida, limita o desempenho nesta ${periodo}.`;
  return `${name} comprometida — priorize recuperação nesta ${periodo}.`;
}

// --- Leitura do Sistema (7 faixas + pilar limitante + balance) ---

function getSystemReading(score: number, pillars: PillarScore, limitingFactor: string): string {
  const limitName = pillarNames[limitingFactor]?.toLowerCase() || limitingFactor;
  const spread = Math.max(pillars.energia, pillars.clareza, pillars.estabilidade) -
                 Math.min(pillars.energia, pillars.clareza, pillars.estabilidade);
  const balanceNote = spread > 1.5
    ? ` Há desbalanceamento significativo entre os pilares — ${limitName} está deslocada em relação aos demais.`
    : spread > 0.8
    ? ` Os pilares apresentam leve desbalanceamento, com ${limitName} como ponto de atenção.`
    : ' Os pilares estão equilibrados entre si.';

  if (score >= 90) return `O sistema opera em condição excelente, com alta integração entre os pilares cognitivos.${balanceNote}`;
  if (score >= 80) return `O sistema está em condição favorável. Boa capacidade de sustentação para demandas elevadas.${balanceNote}`;
  if (score >= 70) return `O sistema opera de forma funcional e responsiva. Capacidade disponível para demandas moderadas a altas.${balanceNote}`;
  if (score >= 60) return `O sistema funciona com capacidade parcial. ${pillarNames[limitingFactor]} requer atenção para manter o rendimento.${balanceNote}`;
  if (score >= 50) return `O sistema opera com restrições. ${pillarNames[limitingFactor]} limita a capacidade disponível para demandas elevadas.${balanceNote}`;
  if (score >= 35) return `O sistema está em modo de conservação. ${pillarNames[limitingFactor]} reduzida compromete o desempenho global.${balanceNote}`;
  return `O sistema está em estado crítico. A capacidade disponível é muito limitada — ${limitName} precisa de intervenção imediata.${balanceNote}`;
}

function getSystemReadingType(score: number): 'insight' | 'warning' | 'positive' {
  if (score >= 70) return 'positive';
  if (score >= 50) return 'insight';
  return 'warning';
}

// --- WhyScore ---

function getWhyScore(score: number): string {
  if (score >= 90) return 'O sistema está otimizado, com pilares alinhados e alta capacidade de sustentação.';
  if (score >= 80) return 'O sistema está em boa forma, com capacidade disponível para desafios intensos.';
  if (score >= 70) return 'O sistema opera de forma funcional, com capacidade para demandas moderadas sem desgaste excessivo.';
  if (score >= 60) return 'O sistema opera com margem reduzida. Capacidade disponível para rotinas, mas demandas extras cobram mais.';
  if (score >= 50) return 'O sistema opera com restrições visíveis. Alguns pilares não sustentam demandas elevadas.';
  if (score >= 35) return 'O sistema está em modo de proteção. A capacidade disponível é limitada e requer gestão ativa.';
  return 'O sistema está em estado de conservação extrema. Priorize recuperação antes de qualquer demanda cognitiva.';
}

// --- Fator Limitante (4 faixas + dose por fase) ---

function getLimitingFactorText(pillar: string, value: number, phase: string): string {
  const name = pillarNames[pillar]?.toLowerCase() || pillar;
  const doseByPhase: Record<string, string> = {
    BOOT: 'Comece o dia com ritmo controlado para preservar essa reserva.',
    HOLD: 'Administre a carga da tarde com pausas regulares.',
    CLEAR: 'Na transição para o descanso, evite estímulos intensos.',
  };
  const dose = doseByPhase[phase] || '';

  if (value >= 4) return `O fator limitante é ${name}, mas está em nível adequado. ${dose}`;
  if (value >= 3) return `O fator limitante é ${name}, com margem estreita para oscilação. ${dose}`;
  if (value >= 2) return `O fator limitante é ${name}, impactando diretamente o desempenho. ${dose}`;
  return `O fator limitante é ${name} em nível crítico — toda atividade deve considerar esse limite. ${dose}`;
}

// --- Risco do Dia (12 cenários com análise cruzada) ---

function getDayRisk(pillars: PillarScore, score: number): string {
  const { energia, clareza, estabilidade } = pillars;

  // Cross-analysis: combinations of low pillars
  if (energia < 2.0 && estabilidade < 2.0) return 'Risco elevado de esgotamento com desregulação emocional. Evite compromissos exigentes.';
  if (energia < 2.0 && clareza < 2.0) return 'Risco de fadiga cognitiva severa. Decisões importantes devem ser adiadas.';
  if (clareza < 2.0 && estabilidade < 2.0) return 'Risco de confusão mental com instabilidade. Foque em tarefas automáticas e previsíveis.';

  if (estabilidade < 2.0) return 'Risco de oscilação emocional e reatividade ao longo do dia.';
  if (energia < 2.0) return 'Risco de fadiga precoce — energia pode se esgotar antes do meio do dia.';
  if (clareza < 2.0) return 'Risco de dispersão cognitiva. Evite multitarefas e decisões complexas.';

  if (estabilidade < 3.0 && energia < 3.0) return 'Risco moderado de desgaste acumulado. Intercale atividades com pausas.';
  if (clareza < 3.0 && estabilidade < 3.0) return 'Risco de perda de foco progressiva ao longo do dia.';
  if (energia < 3.0 && clareza < 3.0) return 'Risco de rendimento abaixo do habitual. Priorize tarefas essenciais.';

  if (score < 50) return 'Dia requer gestão cuidadosa de energia e expectativas.';
  if (score < 65) return 'Dia funcional, mas com margem limitada para imprevistos.';
  return 'Sem riscos significativos detectados para o dia.';
}

// --- Today Means (3 frases: score + pilares + fase) ---

function getTodayMeans(score: number, pillars: PillarScore, phase: string): string[] {
  const sentences: string[] = [];

  // 1. By score
  if (score >= 85) sentences.push('Boa capacidade para trabalho profundo, sustentado e de alto valor.');
  else if (score >= 70) sentences.push('Capacidade funcional para blocos de foco e demandas moderadas.');
  else if (score >= 55) sentences.push('Capacidade limitada — priorize tarefas essenciais e evite sobrecarga.');
  else if (score >= 40) sentences.push('Dia para tarefas simples e automáticas. Evite decisões de alto impacto.');
  else sentences.push('Dia para descanso e recuperação. O sistema precisa de proteção ativa.');

  // 2. By pillar combination
  const { energia, clareza, estabilidade } = pillars;
  if (energia >= 4 && clareza >= 4) sentences.push('A combinação de energia e clareza permite produtividade elevada.');
  else if (energia >= 4 && estabilidade < 3) sentences.push('Há energia disponível, mas a estabilidade limita sua sustentação — use em blocos curtos.');
  else if (clareza >= 4 && energia < 3) sentences.push('Clareza está alta, mas a energia pode não sustentar sessões longas.');
  else if (estabilidade >= 4 && energia < 3) sentences.push('O sistema está estável, mas a energia baixa pede ritmo reduzido.');
  else if (energia < 3 && clareza < 3) sentences.push('Energia e clareza reduzidas — intercale demandas com pausas frequentes.');
  else sentences.push('Intercale atividades de foco com pausas para manter o rendimento ao longo do dia.');

  // 3. By phase
  if (phase === 'BOOT') sentences.push('O melhor aproveitamento de foco tende a acontecer nas próximas horas da manhã.');
  else if (phase === 'HOLD') sentences.push('O sistema pode manter rendimento na primeira metade da tarde com gestão ativa.');
  else sentences.push('A transição para a noite favorece descompressão e atividades leves.');

  return sentences;
}

// --- Pillar Descriptions (5 faixas + cross-reference) ---

function generatePillarDescription(pillar: string, value: number, pillars: PillarScore): string {
  const others = Object.entries(pillars).filter(([k]) => k !== pillar);
  const otherStatus = others.map(([k, v]) => {
    const n = pillarNames[k]?.toLowerCase() || k;
    return v >= 3.5 ? null : `${n} oscila`;
  }).filter(Boolean);
  const crossNote = otherStatus.length > 0 ? ` Atenção: ${otherStatus.join(' e ')}.` : '';

  if (pillar === 'energia') {
    if (value >= 4.5) return `Energia elevada e disponível para demandas intensas.${crossNote}`;
    if (value >= 3.8) return `Energia preservada e funcional para a maioria das atividades.${crossNote}`;
    if (value >= 3.0) return `Energia moderada. Gestão de carga recomendada.${crossNote}`;
    if (value >= 2.0) return `Reserva energética baixa. Ritmo reduzido necessário.${crossNote}`;
    return `Esgotamento energético. Priorize recuperação imediata.${crossNote}`;
  }
  if (pillar === 'clareza') {
    if (value >= 4.5) return `Clareza cognitiva elevada para decisões complexas e trabalho criativo.${crossNote}`;
    if (value >= 3.8) return `Clareza funcional para trabalho sustentado e tomada de decisão.${crossNote}`;
    if (value >= 3.0) return `Clareza parcial. Evite decisões complexas sem pausa.${crossNote}`;
    if (value >= 2.0) return `Clareza comprometida. Foque em tarefas simples e diretas.${crossNote}`;
    return `Dispersão cognitiva significativa. Adie compromissos que exijam julgamento.${crossNote}`;
  }
  // estabilidade
  if (value >= 4.5) return `Estabilidade elevada. Sistema resiliente a variações e estressores.${crossNote}`;
  if (value >= 3.8) return `Estabilidade adequada para demandas moderadas sem oscilação.${crossNote}`;
  if (value >= 3.0) return `Estabilidade oscilante. Reduza estímulos externos e monitore o estado.${crossNote}`;
  if (value >= 2.0) return `Instabilidade detectada. Ambiente controlado e previsível recomendado.${crossNote}`;
  return `Instabilidade significativa. Priorize regulação emocional e descanso.${crossNote}`;
}

// --- Cognitive Window (5 faixas + fase) ---

function getCognitiveWindow(score: number, pillars: PillarScore, phase: string): string {
  const phaseNote = phase === 'BOOT' ? ' Melhor aproveitamento pela manhã.'
    : phase === 'HOLD' ? ' Aproveite o início da tarde.'
    : ' A noite favorece descompressão.';

  if (score >= 80 && pillars.clareza >= 4.0 && pillars.estabilidade >= 4.0) {
    return `Janela cognitiva estimada: 4h+.${phaseNote}`;
  }
  if (score >= 75 && pillars.clareza >= 4.0 && pillars.estabilidade >= 3.5) {
    return `Janela cognitiva estimada: 3–4h.${phaseNote}`;
  }
  if (score >= 65 && pillars.clareza >= 3.5 && pillars.estabilidade >= 3.0) {
    return `Janela cognitiva estimada: 2–3h.${phaseNote}`;
  }
  if (score >= 55 && pillars.clareza >= 3.0) {
    return `Janela cognitiva estimada: 1–2h.${phaseNote}`;
  }
  return `Janela cognitiva indisponível no momento. Foque em recuperação.${phaseNote}`;
}

// --- System Diagnosis (spread analysis + contextual recommendation) ---

function getSystemDiagnosis(score: number, pillars: PillarScore, limitingFactor: string, phase: string): string {
  const limitName = pillarNames[limitingFactor]?.toLowerCase() || limitingFactor;
  const spread = Math.max(pillars.energia, pillars.clareza, pillars.estabilidade) -
                 Math.min(pillars.energia, pillars.clareza, pillars.estabilidade);

  const balanceAnalysis = spread > 1.5
    ? `Desbalanceamento significativo detectado (spread ${spread.toFixed(1)}). ${pillarNames[limitingFactor]} está muito abaixo dos demais pilares.`
    : spread > 0.8
    ? `Leve desbalanceamento entre pilares (spread ${spread.toFixed(1)}). ${pillarNames[limitingFactor]} é o ponto de atenção.`
    : `Pilares equilibrados (spread ${spread.toFixed(1)}). O sistema opera de forma coesa.`;

  let recommendation: string;
  if (score >= 75) {
    recommendation = phase === 'BOOT'
      ? 'Aproveite a manhã para trabalho de alto valor e decisões estratégicas.'
      : phase === 'HOLD'
      ? 'Mantenha o ritmo da tarde com blocos focados e pausas regulares.'
      : 'Inicie a transição para descanso, preservando os ganhos do dia.';
  } else if (score >= 55) {
    recommendation = phase === 'BOOT'
      ? 'Comece o dia com ritmo controlado. Reserve energia para demandas prioritárias.'
      : phase === 'HOLD'
      ? 'Mantenha ritmo controlado na tarde, evitando picos de exigência.'
      : 'Priorize atividades leves e prepare o descanso noturno.';
  } else {
    recommendation = phase === 'BOOT'
      ? 'A manhã deve ser dedicada a estabilização. Adie demandas intensas.'
      : phase === 'HOLD'
      ? 'Proteja a tarde de sobrecargas. Foque em tarefas de baixa demanda.'
      : 'Noite para recuperação ativa e descanso intencional.';
  }

  return `Score ${score}/100. ${balanceAnalysis} Recomendação: ${recommendation}`;
}

// --- Rich Label (delegated to vyr-engine, duplicated here for interpreter) ---

function getRichLabel(score: number, pillars: PillarScore): string {
  const dominant = pillars.energia >= pillars.clareza && pillars.energia >= pillars.estabilidade
    ? 'energia' : pillars.clareza >= pillars.estabilidade ? 'clareza' : 'estabilidade';
  const limiting = getLimitingFactor(pillars);

  if (score >= 90) return dominant === 'energia' ? 'Energia plena' : dominant === 'clareza' ? 'Foco sustentado' : 'Equilíbrio elevado';
  if (score >= 80) return dominant === 'energia' ? 'Energia consolidada' : dominant === 'clareza' ? 'Clareza ampla' : 'Sustentação firme';
  if (score >= 70) return dominant === 'energia' ? 'Energia estável' : dominant === 'clareza' ? 'Clareza disponível' : 'Sustentação adequada';
  if (score >= 60) return dominant === 'energia' ? 'Energia funcional' : dominant === 'clareza' ? 'Foco parcial' : 'Equilíbrio parcial';
  if (score >= 50) return limiting === 'energia' ? 'Energia moderada' : limiting === 'clareza' ? 'Foco instável' : 'Clareza parcial';
  if (score >= 40) return limiting === 'energia' ? 'Reserva baixa' : limiting === 'clareza' ? 'Oscilação detectada' : 'Sustentação necessária';
  if (score >= 25) return limiting === 'energia' ? 'Depleção energética' : limiting === 'clareza' ? 'Instabilidade elevada' : 'Regulação necessária';
  return limiting === 'energia' ? 'Esgotamento energético' : limiting === 'clareza' ? 'Dispersão cognitiva' : 'Recuperação necessária';
}

// --- Main Interpret Function ---

export function interpret(state: VYRState): Interpretation {
  const { pillars, limitingFactor, phase, score } = state;

  // Context items (5 faixas + fase)
  const contextItems: Interpretation['contextItems'] = [
    { text: getPillarContextText('Energia', pillars.energia, phase), status: getPillarStatus(pillars.energia) },
    { text: getPillarContextText('Clareza', pillars.clareza, phase), status: getPillarStatus(pillars.clareza) },
    { text: getPillarContextText('Estabilidade', pillars.estabilidade, phase), status: getPillarStatus(pillars.estabilidade) },
  ];

  // Cognitive window (5 faixas + fase)
  const cognitiveWindow = getCognitiveWindow(score, pillars, phase);

  // System reading (7 faixas + balance)
  const systemReading = getSystemReading(score, pillars, limitingFactor);
  const systemReadingType = getSystemReadingType(score);

  // Why score
  const whyScore = getWhyScore(score);

  // Limiting factor (4 faixas + dose por fase)
  const limitingFactorText = getLimitingFactorText(limitingFactor, pillars[limitingFactor as keyof PillarScore], phase);

  // Day risk (12 cenários)
  const dayRisk = getDayRisk(pillars, score);

  // Today means (3 frases: score + pilares + fase)
  const todayMeans = getTodayMeans(score, pillars, phase);

  // Rich label (8×3 = 24 labels)
  const stateLabel = score === 0 ? 'Sem dados' : getRichLabel(score, pillars);

  // Pillar descriptions (5 faixas + cross-reference)
  const pillarDescriptions: Record<string, string> = {
    energia: generatePillarDescription('energia', pillars.energia, pillars),
    clareza: generatePillarDescription('clareza', pillars.clareza, pillars),
    estabilidade: generatePillarDescription('estabilidade', pillars.estabilidade, pillars),
  };

  // System diagnosis (spread analysis + contextual recommendation)
  const systemDiagnosis = getSystemDiagnosis(score, pillars, limitingFactor, phase);

  return {
    stateLabel,
    contextItems,
    cognitiveWindow,
    systemReading,
    whyScore,
    dayRisk,
    limitingFactorText,
    systemReadingType,
    todayMeans,
    systemDiagnosis,
    pillarDescriptions,
  };
}

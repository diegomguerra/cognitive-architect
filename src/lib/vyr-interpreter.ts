import type { VYRState } from './vyr-engine';

export interface Interpretation {
  stateLabel: string;
  contextItems: { text: string; status: 'favorable' | 'attention' | 'limiting' }[];
  cognitiveWindow: string;
  systemReading: string;
  todayMeans: string[];
}

const stateLabels: Record<string, string> = {
  'Ótimo': 'Foco disponível',
  'Bom': 'Atenção sustentada',
  'Moderado': 'Operacional com ajustes',
  'Baixo': 'Conservação ativa',
  'Crítico': 'Modo de proteção',
};

const pillarNames: Record<string, string> = {
  energia: 'Energia',
  clareza: 'Clareza',
  estabilidade: 'Estabilidade',
};

export function interpret(state: VYRState): Interpretation {
  const { pillars, level, limitingFactor, phase } = state;
  
  const contextItems: Interpretation['contextItems'] = [];
  
  // Strongest pillar
  const pillarEntries = Object.entries(pillars) as [string, number][];
  const sorted = [...pillarEntries].sort((a, b) => b[1] - a[1]);
  
  contextItems.push({
    text: `${pillarNames[sorted[0][0]]} é seu ponto forte hoje (${sorted[0][1].toFixed(1)})`,
    status: 'favorable',
  });
  
  if (sorted[1][1] >= 2.5) {
    contextItems.push({
      text: `${pillarNames[sorted[1][0]]} sustenta o sistema (${sorted[1][1].toFixed(1)})`,
      status: 'favorable',
    });
  } else {
    contextItems.push({
      text: `${pillarNames[sorted[1][0]]} requer atenção (${sorted[1][1].toFixed(1)})`,
      status: 'attention',
    });
  }
  
  contextItems.push({
    text: `${pillarNames[limitingFactor]} limita o desempenho (${pillars[limitingFactor as keyof typeof pillars].toFixed(1)})`,
    status: 'limiting',
  });

  // Cognitive window
  const windowHours = state.score >= 70 ? '3–4h' : state.score >= 55 ? '2–3h' : '1–2h';
  const windowPhase = phase === 'BOOT' ? 'pela manhã' : phase === 'HOLD' ? 'no início da tarde' : 'não recomendada esta noite';
  const cognitiveWindow = `Janela cognitiva estimada: ${windowHours} ${windowPhase}`;

  // System reading
  const systemReading = `O fator limitante é ${pillarNames[limitingFactor].toLowerCase()}. ${
    limitingFactor === 'energia' ? 'Considere priorizar recuperação e hidratação.' :
    limitingFactor === 'clareza' ? 'A regularidade do sono impacta diretamente a clareza.' :
    'A variabilidade cardíaca sugere ajuste na gestão de estresse.'
  }`;

  // Today means
  const todayMeans = state.score >= 70
    ? ['Bom dia para tarefas complexas e decisões importantes', 'Aproveite a janela de foco para trabalho profundo']
    : state.score >= 55
    ? ['Funcional para rotinas, evite sobrecarga cognitiva', 'Intercale blocos de foco com pausas curtas']
    : ['Priorize tarefas simples e automáticas', 'Foque em recuperação — o sistema precisa de margem'];

  return {
    stateLabel: stateLabels[level] || 'Calculando...',
    contextItems,
    cognitiveWindow,
    systemReading,
    todayMeans,
  };
}

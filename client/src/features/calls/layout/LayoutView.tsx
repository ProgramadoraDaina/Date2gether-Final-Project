import type { CSSProperties, ReactNode } from 'react';
import type { LayoutNode, LayoutZone } from './layout';
import styles from './CallLayout.module.css';

interface LayoutViewProps {
  tree: LayoutNode;
  renderZone: (zone: LayoutZone) => ReactNode;
}

const FILL: CSSProperties = { flex: '1 1 0', alignSelf: 'stretch', minWidth: 0, minHeight: 0 };

// The other side of a split always keeps at least 10%.
const MAX_SIZED = 90;

function sizedStyle(zone: LayoutZone, direction: 'row' | 'column'): CSSProperties {
  return direction === 'row'
    ? { flex: `0 1 ${Math.min(zone.width, MAX_SIZED)}%`, height: `${zone.height}%`, minWidth: 0 }
    : { flex: `0 1 ${Math.min(zone.height, MAX_SIZED)}%`, width: `${zone.width}%`, minHeight: 0 };
}

// A sized zone later split by "beside/below previous" stays first in its split and keeps its size.
function leadZone(node: LayoutNode): LayoutZone {
  return node.kind === 'zone' ? node.zone : leadZone(node.children[0]);
}

function NodeView({
  node,
  style,
  renderZone,
}: {
  node: LayoutNode;
  style: CSSProperties;
  renderZone: LayoutViewProps['renderZone'];
}) {
  if (node.kind === 'zone') {
    return (
      <div className={styles.zone} style={style} data-testid="layout-zone">
        {renderZone(node.zone)}
      </div>
    );
  }
  return (
    <div className={styles.split} style={{ ...style, flexDirection: node.direction }}>
      {node.children.map((child, index) => (
        <NodeView
          key={index}
          node={child}
          renderZone={renderZone}
          style={index === node.sized ? sizedStyle(leadZone(child), node.direction) : FILL}
        />
      ))}
    </div>
  );
}

export function LayoutView({ tree, renderZone }: LayoutViewProps) {
  return <NodeView node={tree} renderZone={renderZone} style={{ width: '100%', height: '100%' }} />;
}

class SocialGraph {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  _afinidadColor(af) {
    // 0 = frío (azul), 50 = neutro, 100 = cálido (verde/rojo)
    let t = Math.max(0, Math.min(100, af)) / 100;
    let r, g, b;
    if (t < 0.5) {
      let u = t * 2;
      r = Math.round(40 + u * 40);
      g = Math.round(50 + u * 60);
      b = Math.round(90 + u * 40);
    } else {
      let u = (t - 0.5) * 2;
      r = Math.round(80 + u * 40);
      g = Math.round(110 + u * 80);
      b = Math.round(70 - u * 40);
    }
    return `rgb(${r},${g},${b})`;
  }

  update(sim) {
    if (!this.container) return;
    // Solo render si el modal está visible
    let modal = document.getElementById('social-modal');
    if (modal && modal.style.display === 'none') return;

    let vivas = sim.personas.filter(p => p.isAlive()).slice().sort((a, b) => a.id - b.id);
    if (vivas.length === 0) {
      this.container.innerHTML = '<p style="padding:1rem;color:var(--text-muted);">No hay personas vivas.</p>';
      return;
    }

    let html = '<table class="social-matrix"><thead><tr><th></th>';
    for (let col of vivas) {
      html += `<th title="${col.nombre}">${col.nombre}</th>`;
    }
    html += '</tr></thead><tbody>';

    for (let row of vivas) {
      html += `<tr><th title="${row.nombre}">${row.nombre}</th>`;
      for (let col of vivas) {
        if (row.id === col.id) {
          html += '<td class="social-diag">—</td>';
          continue;
        }
        let af = sim.events.getAfinidad(row.id, col.id);
        let at = row.getAfractionTo(col);
        let esPareja = row.pareja === col.id && col.pareja === row.id;
        let mark = esPareja ? ' ♥' : '';
        let title = `${row.nombre} → ${col.nombre}\nAfinidad: ${af.toFixed(0)}\nAtracción: ${(at * 100).toFixed(0)}%${esPareja ? '\nPareja oficial' : ''}`;
        html += `<td style="background:${this._afinidadColor(af)}" title="${title}">` +
          `Af:${af.toFixed(0)} At:${(at * 100).toFixed(0)}${mark}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    this.container.innerHTML = html;
  }
}

window.SocialGraph = SocialGraph;

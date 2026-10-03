fetchSettings().then((points) => {
  const rows = [
    ['🥇 1st place', points.points_first],
    ['🥈 2nd place', points.points_second],
    ['🥉 3rd place', points.points_third],
    ['Everyone else who entered', points.points_participation],
  ];
  document.getElementById('points-table-body').innerHTML = rows
    .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join('');
}).catch((err) => {
  console.error(err);
  document.getElementById('points-table-body').innerHTML = '<tr><td colspan="2" class="muted">Couldn’t load points settings.</td></tr>';
});

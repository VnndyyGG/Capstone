const roles = {
    cliente:   { name:'María José Pérez', role:'Cliente',                       initials:'MJ', avatarBg:'linear-gradient(160deg,#22C55E,#15803D)', crumb:'Mis trámites', dash:'dash-cliente' },
    admin:     { name:'Kevin Tamayo',      role:'Ejecutivo · Administración',    initials:'KT', avatarBg:'#6D28D9',                                crumb:'Panel de administración', dash:'dash-admin' },
    comercial: { name:'Andy Fuentes',      role:'Ejecutivo · Comercial',         initials:'AF', avatarBg:'#1D4ED8',                                crumb:'Trámites asignados', dash:'dash-comercial' },
    finanzas:  { name:'Matías Oroz',       role:'Ejecutivo · Finanzas',          initials:'MO', avatarBg:'#B45309',                                crumb:'Pagos y reportes', dash:'dash-finanzas' }
  };

  function login(key){
    const r = roles[key];
    document.getElementById('view-login').style.display = 'none';
    document.getElementById('app-shell').style.display = 'block';
    document.getElementById('chip-name').textContent = r.name;
    document.getElementById('chip-role').textContent = r.role;
    document.getElementById('chip-avatar').textContent = r.initials;
    document.getElementById('chip-avatar').style.background = r.avatarBg;
    document.getElementById('crumb-current').textContent = r.crumb;
    document.querySelectorAll('.dash').forEach(d => d.classList.remove('active'));
    document.getElementById(r.dash).classList.add('active');
    window.scrollTo(0,0);
  }
  function logout(){
    document.getElementById('app-shell').style.display = 'none';
    document.getElementById('view-login').style.display = 'flex';
  }
  function showSub(name){
    const container = document.getElementById('sub-' + name).closest('.dash');
    container.querySelectorAll('.subview').forEach(v => v.classList.remove('active'));
    container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('sub-' + name).classList.add('active');
    container.querySelector('.tab[data-sub="' + name + '"]').classList.add('active');
  }
  function docCmd(cmd){ document.execCommand(cmd, false, null); }
  document.querySelectorAll('.ed').forEach(function(el){
    el.contentEditable = 'true';
  });
  function selectDoc(el){
    document.querySelectorAll('.doc-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
  }

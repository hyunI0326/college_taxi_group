const regions = {
  cityhall: { name: '시청', english: 'City Hall', center: [37.5663, 126.9779] },
  gwanghwamun: { name: '광화문', english: 'Gwanghwamun', center: [37.5716, 126.9769] },
  seoulstation: { name: '서울역', english: 'Seoul Station', center: [37.5547, 126.9707] },
};
const state = { region: 'cityhall', user: null, parties: [], selectedId: null, picked: null };
const kakaoTaxiUrl = 'https://kakaomobility-website.onelink.me/cWP4/7d8f8872';
const kakaoSplitUrl = 'https://link.kakaopay.com/t/money/please?chan=payhome_more&capg=service';
const kakaoSplitHistoryUrl = 'https://link.kakaopay.com/t/money/please/home?chan=payhome_more&capg=service';
const query = new URLSearchParams(location.search);
if (regions[query.get('region')]) state.region = query.get('region');
if (/^[a-f0-9-]{36}$/.test(query.get('party') || '')) state.selectedId = query.get('party');
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const won = (amount) => `${amount.toLocaleString('ko-KR')}원`;
const when = (value) => new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
let mainMap;
let mainMarkers;
let pickerMap;
let pickerMarker;
let pendingAction;
let toastTimer;

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 3600);
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch {
    throw new Error('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '요청에 실패했습니다.');
  return result;
}

function requireIdentity(action) {
  if (state.user) return action();
  pendingAction = action;
  $('#identity-dialog').showModal();
}

function icon(kind) {
  return L.divIcon({ className: '', html: `<div class="map-pin ${kind === 'origin' ? 'origin' : ''}"><span>${kind === 'origin' ? '✦' : '●'}</span></div>`, iconSize: [36, 36], iconAnchor: [18, 35] });
}

function initMaps() {
  if (!window.L) {
    $('#main-map').textContent = '지도를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.';
    $('#picker-map').textContent = '지도를 불러오지 못했습니다.';
    return;
  }
  mainMap = L.map('main-map', { zoomControl: false, scrollWheelZoom: false }).setView(regions[state.region].center, 15);
  L.control.zoom({ position: 'bottomright' }).addTo(mainMap);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  }).addTo(mainMap);
  mainMarkers = L.layerGroup().addTo(mainMap);
  renderMap();
}

function renderMap() {
  if (!mainMap) return;
  mainMarkers.clearLayers();
  L.marker(regions[state.region].center, { icon: icon('origin') }).addTo(mainMarkers).bindPopup(`${regions[state.region].name} 출발 지역`);
  for (const party of state.parties) {
    L.marker([party.meeting.lat, party.meeting.lng], { icon: icon('party') })
      .addTo(mainMarkers)
      .bindTooltip(escapeHtml(party.title), { direction: 'top' })
      .on('click', () => selectParty(party.id));
  }
}

function selectParty(id) {
  state.selectedId = id;
  renderList();
  renderDetail();
  const party = state.parties.find((item) => item.id === id);
  if (party && mainMap) mainMap.panTo([party.meeting.lat, party.meeting.lng]);
  if (window.innerWidth < 800) $('#party-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function statusOf(party) {
  if (party.fare !== null) return ['정산 완료', 'settled'];
  if (new Date(party.departureAt) <= new Date()) return ['출발함', 'full'];
  if (party.members.length >= party.seats) return ['모집 마감', 'full'];
  return ['모집 중', ''];
}

function renderList() {
  const openCount = state.parties.filter((party) => statusOf(party)[0] === '모집 중').length;
  $('#party-count').textContent = String(openCount);
  $('#region-description').textContent = `${regions[state.region].name} 주변에서 출발하는 택시팟`;
  $('#map-region-name').textContent = regions[state.region].name;
  if (state.parties.length === 0) {
    $('#party-list').innerHTML = `<div class="empty-state"><div class="empty-graphic" aria-hidden="true">🚕</div><strong>아직 파티가 없어요</strong><p>${regions[state.region].name}에서 출발하는 첫 택시팟을 만들어 보세요.</p><button type="button" data-action="create">첫 파티 만들기 ↗</button></div>`;
    return;
  }
  $('#party-list').innerHTML = state.parties.map((party) => {
    const [label, statusClass] = statusOf(party);
    const avatars = party.members.slice(0, 4).map((member) => `<span title="${escapeHtml(member.name)}">${escapeHtml(member.name[0])}</span>`).join('');
    return `<button class="party-card ${party.id === state.selectedId ? 'selected' : ''}" type="button" data-party="${party.id}" aria-label="${escapeHtml(party.title)} 파티 보기"><div class="party-card-top"><span class="status ${statusClass}">${label}</span><time datetime="${party.departureAt}">${when(party.departureAt)}</time></div><h4>${escapeHtml(party.title)}</h4><p>📍 ${escapeHtml(party.meeting.note || `${regions[state.region].name} 근처 집결지`)}</p><div class="party-card-bottom"><span class="avatar-stack">${avatars}</span><span class="member-count">${party.members.length} / ${party.seats}명</span><span class="card-arrow" aria-hidden="true">↗</span></div></button>`;
  }).join('');
}

function renderDetail() {
  const party = state.parties.find((item) => item.id === state.selectedId);
  if (!party) {
    $('#party-detail').innerHTML = '<div class="detail-placeholder"><span aria-hidden="true">✳</span> 파티를 선택하면 자세한 정보가 여기에 표시돼요.</div>';
    return;
  }
  const [label, statusClass] = statusOf(party);
  const own = state.user && party.members.some((member) => member.id === state.user.id);
  const host = state.user && party.members[0].id === state.user.id;
  const canJoin = party.fare === null && Date.parse(party.departureAt) > Date.now() && party.members.length < party.seats;
  let action = '';
  if (party.fare !== null) {
    action = `<div class="fare-total"><span>총 택시비 · ${party.members.length}명 정산</span><strong>${won(party.fare)}</strong></div><ul class="fare-lines">${party.members.map((member, index) => `<li><span>${escapeHtml(member.name)}${member.id === state.user?.id ? ' (나)' : ''}</span><strong>${won(party.shares[index])}</strong></li>`).join('')}</ul><div class="connect-box"><strong>카카오페이로 정산하기</strong><div class="connect-actions">${host ? `<button class="copy-button" type="button" data-action="fare-copy" data-id="${party.id}">정산 금액 복사</button><a class="external-link" href="${kakaoSplitUrl}" target="_blank" rel="noopener noreferrer">카카오페이 1/N 요청 ↗</a>` : `<a class="external-link" href="${kakaoSplitHistoryUrl}" target="_blank" rel="noopener noreferrer">카카오페이 요청 확인 ↗</a>`}</div><p>모바일 카카오페이에서 참여자와 금액을 다시 확인해 주세요. 송금 완료 여부는 택시팟에 자동 반영되지 않아요.</p></div>${host ? `<div class="detail-action"><form class="fare-form" data-fare="${party.id}"><input aria-label="택시비 수정" name="fare" type="number" min="1" max="500000" step="1" value="${party.fare}" required><button type="submit">금액 수정</button></form></div>` : ''}`;
  } else if (host) {
    action = `<div class="detail-action">${party.members.length >= 2 ? `<form class="fare-form" data-fare="${party.id}"><input aria-label="총 택시비" name="fare" type="number" min="1" max="500000" step="1" placeholder="총 택시비 (원)" required><button type="submit">N빵 계산</button></form><p>탑승 후 영수증의 총 금액을 입력해 주세요.</p>` : '<p>다른 파티원이 참여하면 택시비를 나눌 수 있어요.</p>'}<button class="danger-link" type="button" data-action="cancel" data-id="${party.id}">파티 취소하기</button></div>`;
  } else if (own) {
    action = `<div class="detail-action"><p>참여 중인 파티예요. 지도에서 정확한 집결지를 확인해 주세요.</p><button class="danger-link" type="button" data-action="leave" data-id="${party.id}">파티 나가기</button></div>`;
  } else if (canJoin) {
    action = `<div class="detail-action"><button class="primary-button" type="button" data-action="join" data-id="${party.id}">이 파티 참여하기 <span aria-hidden="true">↗</span></button></div>`;
  } else {
    action = '<div class="detail-action"><p>이 파티의 모집이 끝났어요.</p></div>';
  }
  if (party.fare === null && Date.parse(party.departureAt) > Date.now()) {
    action += `<div class="connect-box"><strong>카카오와 함께 준비하기</strong><div class="connect-actions"><button class="copy-button" type="button" data-action="share" data-id="${party.id}">파티 공유하기</button>${host ? `<button class="copy-button" type="button" data-action="trip-copy" data-id="${party.id}">승차 정보 복사</button><a class="external-link" href="${kakaoTaxiUrl}" target="_blank" rel="noopener noreferrer">카카오 T 앱 열기 ↗</a>` : ''}</div>${host ? '<p>카카오 T 앱에서 집결지·목적지·출발 시간을 입력하고 호출 또는 예약을 완료해 주세요.</p>' : ''}</div>`;
  }
  $('#party-detail').innerHTML = `<div class="detail-top"><span class="status ${statusClass}">${label}</span><small>파티장 ${escapeHtml(party.members[0].name)}</small></div><h3>${escapeHtml(party.title)}</h3><div class="detail-grid"><div class="detail-fact"><small>출발 시간</small><strong>${when(party.departureAt)}</strong></div><div class="detail-fact"><small>참여 인원</small><strong>${party.members.length} / ${party.seats}명</strong></div></div><p class="detail-note">📍 ${escapeHtml(party.meeting.note || '지도에 표시된 핀에서 만나요.')}<br><span>지도 핀: ${party.meeting.lat.toFixed(5)}, ${party.meeting.lng.toFixed(5)}</span></p><div class="detail-members"><strong>함께 타는 사람</strong><div class="member-chips">${party.members.map((member) => `<span class="member-chip ${member.id === state.user?.id ? 'me' : ''}">${escapeHtml(member.name)}${member.id === state.user?.id ? ' · 나' : ''}</span>`).join('')}</div></div>${action}`;
}

async function loadParties() {
  const region = state.region;
  try {
    const { parties } = await api(`/api/parties?region=${region}`);
    if (region !== state.region) return;
    state.parties = parties;
    if (!parties.some((party) => party.id === state.selectedId)) state.selectedId = null;
    renderList();
    renderDetail();
    renderMap();
  } catch (error) { toast(error.message); }
}

function setRegion(region) {
  state.region = region;
  state.selectedId = null;
  if (mainMap) mainMap.setView(regions[region].center, 15);
  document.querySelectorAll('.region-tab').forEach((tab) => {
    const active = tab.dataset.region === region;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  loadParties();
}

function setPicked(latlng) {
  state.picked = { lat: latlng.lat, lng: latlng.lng };
  if (pickerMarker) pickerMarker.setLatLng(latlng);
  else pickerMarker = L.marker(latlng, { icon: icon('origin') }).addTo(pickerMap);
  $('#picked-coordinates').textContent = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
}

function openCreate() {
  if (!window.L) return toast('지도를 불러온 뒤 다시 시도해 주세요.');
  $('#create-region').textContent = regions[state.region].name;
  $('#create-form').reset();
  const minDate = new Date(Date.now() + 15 * 60_000);
  const local = new Date(minDate.getTime() - minDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  $('#party-time').min = local;
  $('#party-time').value = local;
  $('#create-dialog').showModal();
  if (!pickerMap) {
    pickerMap = L.map('picker-map', { scrollWheelZoom: false }).setView(regions[state.region].center, 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    }).addTo(pickerMap);
    pickerMap.on('click', (event) => setPicked(event.latlng));
    $('#picker-map').addEventListener('keydown', (event) => {
      const moves = { ArrowUp: [0.0001, 0], ArrowDown: [-0.0001, 0], ArrowLeft: [0, -0.0001], ArrowRight: [0, 0.0001] };
      if (!moves[event.key]) return;
      event.preventDefault();
      event.stopPropagation();
      const [lat, lng] = moves[event.key];
      setPicked({ lat: state.picked.lat + lat, lng: state.picked.lng + lng });
      pickerMap.panTo([state.picked.lat, state.picked.lng]);
    });
  }
  pickerMap.setView(regions[state.region].center, 16);
  setPicked({ lat: regions[state.region].center[0], lng: regions[state.region].center[1] });
  setTimeout(() => pickerMap.invalidateSize(), 30);
}

async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    toast(message);
  } catch { toast('복사할 수 없습니다. 브라우저 권한을 확인해 주세요.'); }
}

async function shareParty(party) {
  const details = `택시팟 | ${party.title}\n${regions[party.region].name} 출발 · ${when(party.departureAt)}\n집결지: ${party.meeting.note || `${regions[party.region].name} 지도 핀`}\n상명대학교까지 함께 가요!`;
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  const link = new URL('/', location.origin);
  link.searchParams.set('region', party.region);
  link.searchParams.set('party', party.id);
  link.hash = 'find-party';
  if (!navigator.share) return copyText(isLocal ? details : `${details}\n${link}`, '파티 정보를 복사했어요.');
  try {
    await navigator.share({ title: '택시팟 파티', text: details, ...(!isLocal && { url: link.href }) });
  } catch (error) {
    if (error.name !== 'AbortError') toast('공유하지 못했습니다. 다시 시도해 주세요.');
  }
}

document.querySelectorAll('.region-tab').forEach((tab) => tab.addEventListener('click', () => setRegion(tab.dataset.region)));
['#hero-create', '#list-create'].forEach((selector) => $(selector).addEventListener('click', () => requireIdentity(openCreate)));
$('#profile-button').addEventListener('click', () => state.user ? toast(`${state.user.name}님으로 사용 중이에요.`) : $('#identity-dialog').showModal());
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
$('#identity-dialog').addEventListener('close', () => { pendingAction = null; });

$('#identity-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const { user } = await api('/api/session', { method: 'POST', body: JSON.stringify({ name: $('#nickname').value }) });
    state.user = user;
    $('#profile-button').innerHTML = `${escapeHtml(user.name)} <span aria-hidden="true">↗</span>`;
    const action = pendingAction;
    $('#identity-dialog').close();
    renderDetail();
    if (action) action();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});

$('#create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const { party } = await api('/api/parties', {
      method: 'POST',
      body: JSON.stringify({
        region: state.region,
        title: $('#party-title').value,
        departureAt: new Date($('#party-time').value).toISOString(),
        seats: Number($('#party-seats').value),
        meeting: { ...state.picked, note: $('#meeting-note').value },
      }),
    });
    $('#create-dialog').close();
    await loadParties();
    selectParty(party.id);
    toast('파티를 만들었어요!');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});

$('#party-list').addEventListener('click', (event) => {
  const card = event.target.closest('[data-party]');
  if (card) selectParty(card.dataset.party);
  if (event.target.closest('[data-action="create"]')) requireIdentity(openCreate);
});

$('#party-detail').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  const party = state.parties.find((item) => item.id === id);
  if (action === 'share' && party) return shareParty(party);
  if (action === 'trip-copy' && party) return copyText(`${regions[party.region].name} 출발 · ${when(party.departureAt)}\n집결지: ${party.meeting.note || '지도 핀'} (${party.meeting.lat.toFixed(5)}, ${party.meeting.lng.toFixed(5)})\n목적지: 상명대학교`, '승차 정보를 복사했어요.');
  if (action === 'fare-copy' && party && party.fare !== null) return copyText(`택시팟 | ${party.title}\n총 택시비 ${won(party.fare)}\n${party.members.map((member, index) => `${member.name}: ${won(party.shares[index])}`).join('\n')}`, '정산 금액을 복사했어요.');
  if (action === 'join') return requireIdentity(() => doPartyAction(id, action));
  if (action === 'cancel' && !confirm('파티를 취소하면 참여자 목록도 사라집니다. 취소할까요?')) return;
  button.disabled = true;
  await doPartyAction(id, action);
});

async function doPartyAction(id, action) {
  try {
    await api(`/api/parties/${id}/${action}`, { method: 'POST' });
    await loadParties();
    if (action !== 'cancel') selectParty(id);
    toast(action === 'join' ? '파티에 참여했어요!' : action === 'leave' ? '파티에서 나왔어요.' : '파티를 취소했어요.');
  } catch (error) { toast(error.message); await loadParties(); }
}

$('#party-detail').addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-fare]');
  if (!form) return;
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api(`/api/parties/${form.dataset.fare}/fare`, { method: 'POST', body: JSON.stringify({ fare: Number(form.elements.fare.value) }) });
    await loadParties();
    toast('택시비를 나눴어요.');
  } catch (error) { toast(error.message); button.disabled = false; }
});

async function start() {
  document.querySelectorAll('.region-tab').forEach((tab) => {
    const active = tab.dataset.region === state.region;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  initMaps();
  try {
    state.user = (await api('/api/me')).user;
    if (state.user) $('#profile-button').innerHTML = `${escapeHtml(state.user.name)} <span aria-hidden="true">↗</span>`;
  } catch (error) { toast(error.message); }
  await loadParties();
  setInterval(() => {
    if (!document.hidden && !document.querySelector('dialog[open]') && document.activeElement.tagName !== 'INPUT') loadParties();
  }, 20_000);
}
start();

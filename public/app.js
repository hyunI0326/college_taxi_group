const regions = {
  metro: { name: '수도권', center: [37.5663, 126.9779] },
};
const state = { region: 'metro', user: null, parties: [], selectedId: null, picked: null, blockedIds: new Set(), report: null };
const kakaoTaxiUrl = 'https://service.kakaomobility.com/launch/kakaot/';
const kakaoSplitUrl = 'https://link.kakaopay.com/t/money/please?chan=payhome_more&capg=service';
const kakaoSplitHistoryUrl = 'https://link.kakaopay.com/t/money/please/home?chan=payhome_more&capg=service';
const query = new URLSearchParams(location.search);
const isAndroidApp = navigator.userAgent.includes('TaxiPotAndroid/');
const isAndroidCompact = () => isAndroidApp && matchMedia('(max-width: 800px)').matches;
if (isAndroidApp) document.documentElement.classList.add('android-app');
if (/^[a-f0-9-]{36}$/.test(query.get('party') || '')) state.selectedId = query.get('party');
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const won = (amount) => `${amount.toLocaleString('ko-KR')}원`;
const when = (value) => new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
let mainMap;
let mainMarkers;
let pickerMap;
let pickerMarker;
let toastTimer;
let chatPartyId = null;
let chatAfter = null;
let chatLoading = false;

const avatar = (member) => member.avatarUrl
  ? `<img class="member-avatar" src="${escapeHtml(member.avatarUrl)}" alt="" title="${escapeHtml(member.name)}" referrerpolicy="no-referrer">`
  : `<span class="member-avatar" title="${escapeHtml(member.name)}" aria-hidden="true">${escapeHtml(member.name[0])}</span>`;

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
  showAuth();
}

function openIdentity() {
  $('#nickname').value = state.user?.name || '';
  $('#profile-university').textContent = state.user?.university || '';
  $('#identity-kakao').hidden = !window.TaxiPotAndroid?.kakaoReady();
  updateAdPrivacyOptions();
  $('#identity-dialog').showModal();
}

function updateAdPrivacyOptions() {
  $('#ad-privacy-options').hidden = !window.TaxiPotAndroid?.adPrivacyOptionsRequired();
}
window.addEventListener('taxipot-ad-status', updateAdPrivacyOptions);
$('#ad-privacy-options').addEventListener('click', () => window.TaxiPotAndroid?.adPrivacyOptions());

function showAuth() {
  window.TaxiPotAndroid?.setSignedIn(false);
  $('.site-shell').hidden = true;
  $('#auth-screen').hidden = false;
}

async function showApp(user) {
  window.TaxiPotAndroid?.setSignedIn(true);
  state.user = user;
  $('#auth-screen').hidden = true;
  $('.site-shell').hidden = false;
  $('#profile-button').innerHTML = `${escapeHtml(user.name)} <span aria-hidden="true">↗</span>`;
  $('#destination-university').textContent = user.university;
  if (isAndroidApp) {
    $('.hero .eyebrow').textContent = '같은 방향이라면, 함께 가요';
    $('#hero-title').textContent = '대택구';
    $('.hero-copy p').textContent = `${user.university} 친구들과\n같이 타고, 택시비는 가볍게 나눠요.`;
  }
  if (!mainMap) initMaps();
  else requestAnimationFrame(() => mainMap.invalidateSize());
  try {
    const { blockedIds } = await api('/api/blocks');
    state.blockedIds = new Set(blockedIds);
  } catch (error) { toast(error.message); }
  await loadParties();
  if (!user.termsAcceptedAt) $('#rules-dialog').showModal();
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
  if (window.innerWidth < 800 && !isAndroidCompact()) $('#party-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function statusOf(party) {
  if (party.completedAt) return ['이용 완료', 'settled'];
  if (party.fare !== null) return ['정산 중', 'settled'];
  if (new Date(party.departureAt) <= new Date()) return ['출발함', 'full'];
  if (party.members.length >= party.seats) return ['모집 마감', 'full'];
  return ['모집 중', ''];
}

function renderList() {
  const openCount = state.parties.filter((party) => statusOf(party)[0] === '모집 중').length;
  $('#party-count').textContent = String(openCount);
  if (isAndroidApp) $('.list-heading h3').firstChild.textContent = `${state.user.university} 파티 `;
  $('#region-description').textContent = `${state.user.university} 학생들의 택시 파티`;
  $('#map-region-name').textContent = state.user.university;
  if (state.parties.length === 0) {
    $('#party-list').innerHTML = `<div class="empty-state"><div class="empty-graphic" aria-hidden="true">🚕</div><strong>아직 파티가 없어요</strong><p>${escapeHtml(state.user.university)}의 첫 파티를 만들어 보세요.</p><button type="button" data-action="create">첫 파티 만들기 ↗</button></div>`;
    return;
  }
  $('#party-list').innerHTML = state.parties.map((party) => {
    const [label, statusClass] = statusOf(party);
    const avatars = party.members.slice(0, 4).map(avatar).join('');
    return `<button class="party-card ${party.id === state.selectedId ? 'selected' : ''}" type="button" data-party="${party.id}" aria-label="${escapeHtml(party.title)} 파티 보기"><div class="party-card-top"><span class="status ${statusClass}">${label}</span><time datetime="${party.departureAt}">${when(party.departureAt)}</time></div><h4>${escapeHtml(party.title)}</h4><p>📍 ${escapeHtml(party.meeting.note || '지도에 표시된 집결지')}</p><div class="party-card-bottom"><span class="avatar-stack">${avatars}</span><span class="member-count">${party.members.length} / ${party.seats}명</span><span class="card-arrow" aria-hidden="true">↗</span></div></button>`;
  }).join('');
}

function renderDetail() {
  if (mainMap && $('#main-map').parentElement?.classList.contains('detail-map-slot')) {
    $('.map-card').insertBefore($('#main-map'), $('.map-footer'));
    requestAnimationFrame(() => mainMap.invalidateSize());
  }
  const party = state.parties.find((item) => item.id === state.selectedId);
  $('#party-detail').classList.toggle('open', Boolean(party) && isAndroidCompact());
  document.documentElement.classList.toggle('android-detail-open', Boolean(party) && isAndroidCompact());
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
    action = `<div class="fare-total"><span>총 택시비 · ${party.members.length}명 정산</span><strong>${won(party.fare)}</strong></div><ul class="fare-lines">${party.members.map((member, index) => `<li><span>${escapeHtml(member.name)}${member.id === state.user?.id ? ' (나)' : ''}</span><strong>${won(party.shares[index])}</strong></li>`).join('')}</ul><div class="connect-box"><strong>카카오페이로 정산하기</strong><div class="connect-actions">${host ? `<button class="copy-button" type="button" data-action="fare-copy" data-id="${party.id}">정산 금액 복사</button><a class="external-link" href="${kakaoSplitUrl}" target="_blank" rel="noopener noreferrer">카카오페이 1/N 요청 ↗</a>` : `<a class="external-link" href="${kakaoSplitHistoryUrl}" target="_blank" rel="noopener noreferrer">카카오페이 요청 확인 ↗</a>`}</div><p>모바일 카카오페이에서 참여자와 금액을 다시 확인해 주세요. 송금 완료 여부는 대택구에 자동 반영되지 않아요.</p></div>${host && !party.completedAt ? `<div class="detail-action"><form class="fare-form" data-fare="${party.id}"><input aria-label="택시비 수정" name="fare" type="number" min="1" max="500000" step="1" value="${party.fare}" required><button type="submit">금액 수정</button></form></div>` : ''}`;
    if (party.completedAt) {
      action += '<p class="detail-note">파티장이 탑승과 정산을 마쳤다고 표시했습니다. 송금 완료 여부는 앱에서 확인하지 않습니다.</p>';
    } else if (host) {
      action += `<div class="detail-action"><button class="primary-button" type="button" data-action="complete" data-id="${party.id}">탑승·정산 마치기</button><p>실제 탑승과 정산 요청을 마친 뒤 눌러 주세요. 송금 완료 여부는 자동 확인되지 않습니다.</p></div>`;
    }
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
  if (own && Date.parse(party.departureAt) > Date.now() - 7 * 86_400_000) action = `<div class="detail-action"><button class="chat-open" type="button" data-action="chat" data-id="${party.id}">파티 채팅 열기 ↗</button></div>${action}`;
  $('#party-detail').innerHTML = `<button class="detail-close" type="button" data-action="detail-close" aria-label="파티 상세 닫기">닫기</button><div class="detail-top"><span class="status ${statusClass}">${label}</span><small>파티장 ${escapeHtml(party.members[0].name)}</small></div><h3>${escapeHtml(party.title)}</h3><div class="detail-grid"><div class="detail-fact"><small>출발 시간</small><strong>${when(party.departureAt)}</strong></div><div class="detail-fact"><small>참여 인원</small><strong>${party.members.length} / ${party.seats}명</strong></div></div><p class="detail-note">📍 ${escapeHtml(party.meeting.note || '지도에 표시된 핀에서 만나요.')}<br><span>지도 핀: ${party.meeting.lat.toFixed(5)}, ${party.meeting.lng.toFixed(5)}</span></p><div class="detail-members"><strong>함께 타는 사람</strong><div class="member-chips">${party.members.map((member) => `<span class="member-chip ${member.id === state.user?.id ? 'me' : ''}">${avatar(member)}${escapeHtml(member.name)}${member.id === state.user?.id ? ' · 나' : member.id.startsWith('deleted-') ? '' : `<span class="member-controls"><button type="button" data-action="report" data-id="${party.id}" data-member-id="${member.id}" aria-label="${escapeHtml(member.name)} 신고">신고</button><button type="button" data-action="block" data-id="${party.id}" data-member-id="${member.id}" aria-label="${escapeHtml(member.name)} ${state.blockedIds.has(member.id) ? '차단 해제' : '차단'}">${state.blockedIds.has(member.id) ? '차단 해제' : '차단'}</button></span>`}</span>`).join('')}</div></div>${action}`;
  if (!host && !party.members[0].id.startsWith('deleted-')) {
    $('#party-detail h3').insertAdjacentHTML('afterend', `<button class="content-report" type="button" data-action="report" data-id="${party.id}" data-member-id="${party.members[0].id}">파티 내용 신고</button>`);
  }
  if (isAndroidCompact() && mainMap) {
    const slot = document.createElement('div');
    slot.className = 'detail-map-slot';
    $('#party-detail').insertBefore(slot, $('#party-detail .detail-note'));
    slot.append($('#main-map'));
    requestAnimationFrame(() => { mainMap.invalidateSize(); mainMap.setView([party.meeting.lat, party.meeting.lng], 17); });
  }
}

async function loadChat() {
  if (!chatPartyId || chatLoading || !$('#chat-dialog').open) return;
  const partyId = chatPartyId;
  chatLoading = true;
  try {
    const { messages, nextAfter } = await api(`/api/parties/${partyId}/messages${chatAfter === null ? '' : `?after=${chatAfter}`}`);
    if (partyId !== chatPartyId) return;
    const box = $('#chat-messages');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 70;
    const party = state.parties.find((item) => item.id === partyId);
    for (const message of messages) {
      const member = party?.members.find((item) => item.id === message.senderId) || { name: message.senderName, avatarUrl: null };
      const mine = message.senderId === state.user?.id;
      box.insertAdjacentHTML('beforeend', `<div class="chat-line ${mine ? 'mine' : ''}">${mine ? '' : avatar(member)}<div><strong>${escapeHtml(member.name)}</strong><p>${escapeHtml(message.body)}</p><small>${when(message.createdAt)}</small>${mine ? '' : `<button class="chat-report" type="button" data-message-id="${message.id}" data-member-id="${message.senderId}">신고</button>`}</div></div>`);
    }
    if (nextAfter !== null && nextAfter !== undefined) chatAfter = nextAfter;
    if (nearBottom) box.scrollTop = box.scrollHeight;
    if (chatAfter === null) box.innerHTML = '<p class="chat-empty">아직 메시지가 없어요. 첫 메시지를 보내 보세요.</p>';
    else box.querySelector('.chat-empty')?.remove();
  } catch (error) { toast(error.message); }
  finally { chatLoading = false; }
}

function openChat(id) {
  chatPartyId = id;
  chatAfter = null;
  $('#chat-messages').innerHTML = '';
  $('#chat-dialog').showModal();
  loadChat();
}

async function loadParties() {
  if (!state.user) return;
  try {
    const { parties } = await api('/api/parties');
    state.parties = parties;
    if (!parties.some((party) => party.id === state.selectedId)) state.selectedId = null;
    renderList();
    renderDetail();
    renderMap();
  } catch (error) { toast(error.message); }
}

function setPicked(latlng) {
  state.picked = { lat: latlng.lat, lng: latlng.lng };
  if (pickerMarker) pickerMarker.setLatLng(latlng);
  else pickerMarker = L.marker(latlng, { icon: icon('origin') }).addTo(pickerMap);
  $('#picked-coordinates').textContent = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
}

function openCreate() {
  if (!window.L) return toast('지도를 불러온 뒤 다시 시도해 주세요.');
  $('#create-region').textContent = state.user.university;
  $('#create-form').reset();
  document.querySelectorAll('[data-seats]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.seats === $('#party-seats').value)));
  const localTime = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  $('#party-time').min = localTime(new Date(Date.now() + 15 * 60_000));
  $('#party-time').max = localTime(new Date(Date.now() + 14 * 86_400_000));
  $('#party-time').value = localTime(new Date(Date.now() + 30 * 60_000));
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
    if (window.TaxiPotAndroid) window.TaxiPotAndroid.copyText(value);
    else await navigator.clipboard.writeText(value);
    toast(message);
  } catch { toast('복사할 수 없습니다. 브라우저 권한을 확인해 주세요.'); }
}

async function shareParty(party) {
  const details = `대택구 | ${party.title}\n${party.university} · ${when(party.departureAt)}\n집결지: ${party.meeting.note || '지도 핀'}\n${party.university}까지 함께 가요!`;
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  const link = new URL('/', location.origin);
  link.searchParams.set('party', party.id);
  link.hash = 'find-party';
  if (window.TaxiPotAndroid && !isLocal) return window.TaxiPotAndroid.share('대택구 파티 공유', details, link.href);
  if (!navigator.share) return copyText(isLocal ? details : `${details}\n${link}`, '파티 정보를 복사했어요.');
  try {
    await navigator.share({ title: '대택구 파티', text: details, ...(!isLocal && { url: link.href }) });
  } catch (error) {
    if (error.name !== 'AbortError') toast('공유하지 못했습니다. 다시 시도해 주세요.');
  }
}

document.querySelectorAll('[data-seats]').forEach((button) => button.addEventListener('click', () => {
  $('#party-seats').value = button.dataset.seats;
  document.querySelectorAll('[data-seats]').forEach((option) => option.setAttribute('aria-pressed', String(option === button)));
}));
['#hero-create', '#list-create'].forEach((selector) => $(selector).addEventListener('click', () => requireIdentity(openCreate)));
$('#profile-button').addEventListener('click', openIdentity);
$('#kakao-profile-button').addEventListener('click', () => window.TaxiPotAndroid?.kakaoLogin());
$('#identity-kakao').addEventListener('click', () => window.TaxiPotAndroid?.kakaoLogin());
document.addEventListener('click', (event) => {
  const link = event.target.closest('a.external-link[target="_blank"]');
  if (!link || !navigator.userAgent.includes('TaxiPotAndroid/')) return;
  event.preventDefault();
  location.assign(link.href);
});
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
document.querySelectorAll('[data-auth-mode]').forEach((tab) => tab.addEventListener('click', () => {
  const register = tab.dataset.authMode === 'register';
  document.querySelectorAll('[data-auth-mode]').forEach((item) => {
    item.classList.toggle('active', item === tab);
    item.setAttribute('aria-selected', String(item === tab));
  });
  $('.register-fields').hidden = !register;
  $('#auth-name').disabled = !register;
  $('#auth-university').disabled = !register;
  $('#auth-rules').disabled = !register;
  $('#auth-password').autocomplete = register ? 'new-password' : 'current-password';
  $('#auth-form .primary-button').textContent = register ? '회원가입하고 시작하기' : '로그인';
  $('#auth-error').hidden = true;
}));
$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  const register = $('[data-auth-mode="register"]').classList.contains('active');
  const body = { loginId: $('#auth-id').value, password: $('#auth-password').value };
  if (register) Object.assign(body, { name: $('#auth-name').value, university: $('#auth-university').value, acceptedRules: $('#auth-rules').checked });
  try {
    const { user } = await api(register ? '/api/register' : '/api/login', { method: 'POST', body: JSON.stringify(body) });
    $('#auth-password').value = '';
    await showApp(user);
  } catch (error) {
    $('#auth-error').textContent = error.message;
    $('#auth-error').hidden = false;
  } finally { button.disabled = false; }
});
async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
    $('#identity-dialog').close();
    $('#rules-dialog').close();
    state.user = null;
    state.parties = [];
    state.selectedId = null;
    showAuth();
  } catch (error) { toast(error.message); }
}
$('#logout-button').addEventListener('click', logout);
$('#rules-logout').addEventListener('click', logout);
$('#rules-dialog').addEventListener('cancel', (event) => event.preventDefault());
$('#rules-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api('/api/accept-rules', { method: 'POST', body: JSON.stringify({ acceptedRules: $('#rules-consent').checked }) });
    state.user.termsAcceptedAt = Date.now();
    $('#rules-dialog').close();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
$('#report-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api('/api/reports', { method: 'POST', body: JSON.stringify({ ...state.report, reason: $('#report-reason').value }) });
    $('#report-dialog').close();
    $('#report-reason').value = '';
    toast('신고가 접수되었습니다.');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
$('#chat-dialog').addEventListener('close', () => { chatPartyId = null; });
$('#chat-messages').addEventListener('click', (event) => {
  const button = event.target.closest('[data-message-id]');
  if (!button || !chatPartyId) return;
  state.report = { partyId: chatPartyId, reportedUserId: button.dataset.memberId, messageId: Number(button.dataset.messageId) };
  $('#report-dialog').showModal();
});
$('#chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const partyId = chatPartyId;
  if (!partyId) return;
  const button = event.submitter;
  button.disabled = true;
  try {
    await api(`/api/parties/${partyId}/messages`, { method: 'POST', body: JSON.stringify({ body: $('#chat-input').value }) });
    if (partyId !== chatPartyId) return;
    $('#chat-input').value = '';
    await loadChat();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});

$('#identity-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const { user } = await api('/api/session', { method: 'POST', body: JSON.stringify({ name: $('#nickname').value }) });
    state.user = user;
    $('#profile-button').innerHTML = `${escapeHtml(user.name)} <span aria-hidden="true">↗</span>`;
    $('#identity-dialog').close();
    renderDetail();
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
  if (action === 'detail-close') {
    state.selectedId = null;
    renderDetail();
    renderList();
    return;
  }
  const party = state.parties.find((item) => item.id === id);
  if (action === 'share' && party) return shareParty(party);
  if (action === 'trip-copy' && party) return copyText(`${party.university} 파티 · ${when(party.departureAt)}\n집결지: ${party.meeting.note || '지도 핀'} (${party.meeting.lat.toFixed(5)}, ${party.meeting.lng.toFixed(5)})\n목적지: ${party.university}`, '승차 정보를 복사했어요.');
  if (action === 'fare-copy' && party && party.fare !== null) return copyText(`대택구 | ${party.title}\n총 택시비 ${won(party.fare)}\n${party.members.map((member, index) => `${member.name}: ${won(party.shares[index])}`).join('\n')}`, '정산 금액을 복사했어요.');
  if (action === 'chat' && party) return openChat(id);
  if (action === 'report' && party) {
    state.report = { partyId: id, reportedUserId: button.dataset.memberId };
    $('#report-dialog').showModal();
    return;
  }
  if (action === 'block' && party) {
    const memberId = button.dataset.memberId;
    const blocked = state.blockedIds.has(memberId);
    try {
      if (blocked) await api(`/api/blocks/${memberId}`, { method: 'DELETE' });
      else await api('/api/blocks', { method: 'POST', body: JSON.stringify({ partyId: id, blockedUserId: memberId }) });
      if (blocked) state.blockedIds.delete(memberId);
      else state.blockedIds.add(memberId);
      renderDetail();
      toast(blocked ? '차단을 해제했어요.' : '파티원을 차단했어요. 채팅 메시지가 숨겨집니다.');
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'join') return requireIdentity(() => doPartyAction(id, action));
  if (action === 'complete' && !confirm('탑승과 정산 요청을 마쳤나요? 송금 완료 여부는 앱에서 확인하지 않습니다. 파티를 마치면 금액을 수정할 수 없습니다.')) return;
  if (action === 'cancel' && !confirm('파티를 취소하면 참여자 목록도 사라집니다. 취소할까요?')) return;
  button.disabled = true;
  await doPartyAction(id, action);
});

async function doPartyAction(id, action) {
  try {
    await api(`/api/parties/${id}/${action}`, { method: 'POST' });
    await loadParties();
    if (action !== 'cancel') selectParty(id);
    if (action === 'complete') window.TaxiPotAndroid?.showCompletionAd(id);
    toast(action === 'join' ? '파티에 참여했어요!' : action === 'leave' ? '파티에서 나왔어요.' : action === 'complete' ? '파티 이용을 마쳤어요.' : '파티를 취소했어요.');
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
  if (window.TaxiPotAndroid?.kakaoReady()) $('#kakao-profile-button').hidden = false;
  showAuth();
  try {
    const { universities } = await api('/api/universities');
    $('#auth-university').insertAdjacentHTML('beforeend', universities.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join(''));
  } catch (error) { toast(error.message); }
  try {
    const { user } = await api('/api/me');
    if (user) await showApp(user);
  } catch (error) { toast(error.message); }
  setInterval(() => {
    if (state.user && !document.hidden && !document.querySelector('dialog[open]') && document.activeElement.tagName !== 'INPUT') loadParties();
  }, 20_000);
  setInterval(() => { if (!document.hidden) loadChat(); }, 3_000);
}
start();

const { createApp, reactive, ref, computed, onMounted } = Vue

const App = {
  setup() {
    const params = reactive({
      S: 663,
      alpha: 0.15,
      t_annex_mn: 0.015,
      t_annex_mx: 0.12,
      small_cutoff: 0.10,
      b: 0.20
    })

    const global = reactive({ roundMode: 'nearest' })

    const parties = reactive([
      { code: 'RPNR', name: 'RPNR', votes: 3217496, d: 130, inAnnex: true },
      { code: 'PSD+', name: 'PSD+', votes: 2490223, d: 118, inAnnex: true },
      { code: 'ADLR', name: 'ADLR', votes: 1527273, d: 98, inAnnex: true },
      { code: 'NDC', name: 'NDC', votes: 962304, d: 86, inAnnex: true },
      { code: 'PS', name: 'PS', votes: 876295, d: 58, inAnnex: true },
      { code: 'NTEA', name: 'NTEA', votes: 840973, d: 33, inAnnex: true },
      { code: 'PRN', name: 'PRN', votes: 689846, d: 28, inAnnex: true },
      { code: 'LTI', name: 'LTI', votes: 639623, d: 58, inAnnex: true },
      { code: 'PEV', name: 'PÉV', votes: 603945, d: 21, inAnnex: true },
      { code: 'PPI', name: 'PPI', votes: 397650, d: 18, inAnnex: true },
      { code: 'FFT', name: 'FFT', votes: 171973, d: 5, inAnnex: true },
      { code: 'NONS', name: 'Non-inscrits', votes: 154623, d: 10, inAnnex: false },
      { code: 'OTHER', name: 'Other', votes: 49388, d: 0, inAnnex: false }
    ])

    const resultReady = ref(false)
    const resultTable = ref([])
    const errorMessage = ref('')

    const totalVotes = computed(() =>
      parties.reduce((sum, p) => sum + (Number.isFinite(p.votes) ? p.votes : 0), 0)
    )

    const isValidInput = computed(() => {
      if (!Number.isFinite(params.S) || params.S < 1) return false
      if (!Number.isFinite(params.alpha) || params.alpha < 0 || params.alpha > 1) return false
      if (!Number.isFinite(params.t_annex_mn) || params.t_annex_mn < 0 || params.t_annex_mn_min > 1) return false
      if (!Number.isFinite(params.small_cutoff) || params.small_cutoff < 0 || params.small_cutoff > 1) return false
      if (!Number.isFinite(params.b) || params.b < 0 || params.b > 1) return false
      if (totalVotes.value < 1) return false
      if (parties.length === 0) return false
      if (parties.some(p => !p.name || p.votes < 0 || p.d < 0 || !Number.isFinite(p.votes) || !Number.isFinite(p.d))) return false
      const totalDistrictSeats = parties.reduce((sum, p) => sum + p.d, 0)
      if (totalDistrictSeats > params.S) return false
      return true
    })

    function formatInt(n) { return Number.isFinite(n) ? n.toLocaleString() : '0' }
    function addParty() { parties.push({ code: `NEW${parties.length + 1}`, name: 'NEW', votes: 100000, d: 0, inAnnex: true }) }
    function removeParty(i) { parties.splice(i, 1) }
    function resetSample() { window.location.reload() }

    function hareEntitlement(votesArr, S) {
      const V = votesArr.reduce((a, b) => a + b, 0)
      if (V <= 0) throw new Error('Total votes must be positive')
      const Q = V / S
      const q = votesArr.map(v => Math.floor(v / Q))
      const remainders = votesArr.map((v, i) => (v / Q) - q[i])
      let R = S - q.reduce((a, b) => a + b, 0)
      const idxs = remainders.map((r, i) => ({ r, i }))
        .sort((a, b) => b.r - a.r || votesArr[b.i] - votesArr[a.i])
      for (let k = 0; k < R && k < idxs.length; k++) { q[idxs[k].i] += 1 }
      return q
    }

    function computeWeights(p) { return (p <= 0 || p >= 1) ? 0 : 1 / (p * (1 - p)) }
    function roundVal(x, mode = 'nearest') {
      if (!Number.isFinite(x)) return 0
      if (mode === 'nearest') return Math.round(x)
      if (mode === 'ceil') return Math.ceil(x)
      return Math.floor(x)
    }

    function runSimulation() {
      errorMessage.value = ''
      resultReady.value = false
      try {
        if (!isValidInput.value) {
          throw new Error('Invalid inputs: check values and district seats ≤ total seats.')
        }

        const S = params.S
        const C = Math.floor(params.alpha * S)
        const partiesCopy = parties.map(p => ({ ...p }))
        const V = totalVotes.value
        if (V <= 0) throw new Error('Total votes must be positive')
        partiesCopy.forEach(p => p.p = p.votes / V)

        const votesArr = partiesCopy.map(p => p.votes)
        const entArr = hareEntitlement(votesArr, S)
        partiesCopy.forEach((p, i) => p.e = entArr[i])

        partiesCopy.forEach(p => p.baseline = Math.max(0, p.e - p.d))
        partiesCopy.forEach(p => p.eligible = (p.p >= params.t_annex_mn && p.p <= params.t_annex_mx && p.inAnnex))

        const smallSet = partiesCopy.filter(p => p.eligible && p.p < params.small_cutoff)
        const B_raw = smallSet.reduce((a, p) => a + (params.b * p.e), 0)

        const weights = smallSet.map(p => computeWeights(p.p))
        const wSum = weights.reduce((a, b) => a + b, 0) || 1
        const boosts = smallSet.map((p, i) => wSum > 0 ? B_raw * (weights[i] / wSum) : 0)

        smallSet.forEach((p, i) => p.boost = boosts[i])
        partiesCopy.forEach(p => { if (!p.boost) p.boost = 0 })

        partiesCopy.forEach(p => p.aug = p.baseline + p.boost)
        partiesCopy.forEach(p => p.augRounded = roundVal(p.aug, global.roundMode))

        const allocation = partiesCopy.reduce((acc, p) => { acc[p.code] = 0; return acc }, {})

        const smallDemands = partiesCopy.filter(p => p.eligible && p.p < params.small_cutoff)
          .map(p => ({ code: p.code, demand: p.augRounded, name: p.name, votes: p.votes }))
        const smallTotalDemand = smallDemands.reduce((a, b) => a + b.demand, 0)

        if (smallTotalDemand >= C) {
          const base = smallDemands.map(s => ({ ...s, fraction: (s.demand / smallTotalDemand) * C }))
          base.forEach(b => b.floor = Math.floor(b.fraction))
          let used = base.reduce((a, b) => a + b.floor, 0)
          let rem = C - used
          base.forEach(b => b.remainder = b.fraction - b.floor)
          base.sort((a, b) => b.remainder - a.remainder || b.votes - a.votes)
          for (let i = 0; i < rem && i < base.length; i++) { base[i].floor += 1 }
          base.forEach(b => allocation[b.code] = b.floor)
        } else {
          smallDemands.forEach(s => allocation[s.code] = s.demand)
          let remaining = C - smallTotalDemand
          const largeList = partiesCopy.filter(p => p.eligible && !(p.p < params.small_cutoff) && p.augRounded > 0)
            .map(p => ({ code: p.code, demand: p.augRounded, votes: p.votes }))
          const totalLargeDemand = largeList.reduce((a, b) => a + b.demand, 0)
          if (totalLargeDemand > 0) {
            const frac = largeList.map(l => ({ ...l, fraction: (l.demand / totalLargeDemand) * remaining }))
            frac.forEach(f => f.floor = Math.floor(f.fraction))
            let used = frac.reduce((a, b) => a + b.floor, 0)
            let rem = remaining - used
            frac.forEach(f => f.remainder = f.fraction - f.floor)
            frac.sort((a, b) => b.remainder - a.remainder || b.votes - a.votes)
            for (let i = 0; i < rem && i < frac.length; i++) { frac[i].floor += 1 }
            frac.forEach(f => allocation[f.code] = f.floor)
          }
        }

        resultTable.value = partiesCopy.map(p => ({
          code: p.code,
          name: p.name,
          v: p.votes,
          p: p.p,
          d: p.d,
          e: p.e,
          baseline: p.baseline,
          boost: p.boost || 0,
          aug: p.aug || 0,
          a: allocation[p.code] || 0,
          total: p.d + (allocation[p.code] || 0)
        }))
        resultReady.value = true
      } catch (err) {
        errorMessage.value = err.message || 'An error occurred.'
      }
    }

    onMounted(() => {
      if (typeof Sortable === 'undefined') {
        console.warn('Sortable not found — make sure you included Sortable.min.js before script.js')
        return
      }

      const tbody = document.getElementById('party-tbody')
      if (!tbody) {
        console.warn('party-tbody not found in DOM yet.')
        return
      }

      Sortable.create(tbody, {
        animation: 150,
        handle: '.drag-handle',
        onEnd: (evt) => {
          const oldIndex = evt.oldIndex
          const newIndex = evt.newIndex
          if (oldIndex === newIndex) return
          const moved = parties.splice(oldIndex, 1)[0]
          parties.splice(newIndex, 0, moved)
        }
      })
    })

    return {
      params, global, parties, resultReady, resultTable, errorMessage,
      totalVotes, isValidInput,
      formatInt, addParty, removeParty, resetSample, runSimulation
    }
  },

  template: `
  <div class="p-4 max-w-5xl mx-auto font-sans">
    ㅤ__________________________________________________________________________________________________________
    <h1 class="text-2xl font-bold mb-3">Annex Apportionment Simulator</h1>
    <p class="mb-4 text-sm text-gray-700">
      <strong>Annex Apportionment using Luzhek Method</strong> — A seat apportionment simulator for non-voting seats of a legislative chamber.
    </p>
    <p class="mb-4 text-sm text-gray-700">
      For use in nations with a Split-Chamber System. Wherein a chamber is split into voting (Deliberative) and non-voting (Annex) seats, and wherein said Annex seats are apportioned [quasi-]proportionally to avoid raising the seat cieling of the main chamber. (Also to compleletely avoid proportionality in the main chamber)
    </p>
    <p class="mb-4 text-sm text-gray-700">
      <strong><span style="text-decoration: underline;">Fun Fact</span></strong>: This system originated, and is only present, in <strong>Tschabelia</strong> | <strong><a href="https://www.nationstates.net/nation=tschabelia" target="_blank" class="text-blue-600 hover:underline">Tschabelia on NationStates.net</a></strong>.
    </p>
    <p class="mb-4 text-sm text-gray-700">
      <strong>Instructions:</strong> All fields must be non-negative. Percentages must be in decimal form (e.g. 0.15 = 15%).
    </p>



    <p class="mb-4 text-sm text-gray-700">
      • In <span style="text-decoration: underline;">Parameters</span>:
    </p>
    <p class="mb-4 text-sm text-gray-700">
      ㅤ◦ 1. Enter the total seat count of the voting section of your chamber.
    </p>
    <p class="mb-4 text-sm text-gray-700">
      ㅤ◦ 2. Enter a percentage to set the maximum number of seats in the annex by using total Deliberative seats as a base to multiply by. Fractions will always be <span style="text-decoration: underline;">rounded down</span>.
    </p>
    <p class="mb-4 text-sm text-gray-700">
      ㅤ◦ 3. Enter the <span style="text-decoration: underline;">minimum</span> vote share percentage allowed for eligibilty in the Annex.
    </p>
    <p class="mb-4 text-sm text-gray-700">
      ㅤ◦ 4. Enter the <span style="text-decoration: underline;">maximum</span> vote share percentage allowed for eligibilty in the Annex.
    </p>
    <p class="mb-4 text-sm text-gray-700">
      ㅤ◦ 5. Enter the vote share percentage above which parties are no longer considered "small" and not eligible for a "boost". (Like a soft cap, in comparison to 4.'s hard cap)
    </p>
    <p class="mb-4 text-sm text-gray-700">
      ㅤ◦ 6. Enter the amount by which you wish to boost small parties. (Keep in mind that the program still needs to apportion on a small first basis; this parameter wont always be reflected to its full potential)
    </p>



    <p class="mb-4 text-sm text-gray-700">
      • In <span style="text-decoration: underline;">Global</span>:
    </p>
    <p class="mb-4 text-sm text-gray-700">
      ㅤ◦ The total voter turnout box offers no input. It's just a display.
    </p>
    <p class="mb-4 text-sm text-gray-700">
      ㅤ◦ Choose your preferred rounding mode when calculating Annex seat amounts. (e.g Nearest rounds from .5, Ceil rounds up no matter the decimal, Floor rounds down no matter the decimal)
    </p>



    <p class="mb-4 text-sm text-gray-700">
      • In <span style="text-decoration: underline;">Parties</span>:
    </p>
    <p class="mb-4 text-sm text-gray-700">
      ㅤ◦ Remove sample party data.
    </p>
    <p class="mb-4 text-sm text-gray-700">
      ㅤ◦ Customize to your preferences.
    </p>
    <p class="mb-4 text-sm text-gray-700">
      ㅤ◦ Check/Uncheck boxes to decide if a party is allowed representation in the Annex.
    </p>
    <p class="mb-4 text-sm text-gray-700">
      ㅤ◦ Drag and drop to reorganize your parties with the handles on the left side of the table.
    </p>



    <p class="mb-4 text-sm text-gray-700">
      • When you're finished click <strong>Run</strong>.
    </p>
    ㅤ__________________________________________________________________________________________________________
    
    <p class="mb-4 text-sm text-gray-700">
      Sample data is from Tschabelia's 2021 Chamber of Deputies Election
    </p>

    <!-- Error Message -->
    <div v-if="errorMessage" class="mb-4 p-3 bg-red-100 text-red-700 border border-red-300 rounded">
      {{ errorMessage }}
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <!-- Parameters Panel -->
      <div class="p-3 border rounded">
        <h2 class="font-semibold mb-2">Parameters</h2>
        <label class="block text-sm">1. Deliberative seats
          <input v-model.number="params.S" type="number" min="1" class="w-full mt-1 p-1 border rounded" />
        </label>
        <label class="block text-sm mt-2">ㅤ2. Annex cap (%)
          <input v-model.number="params.alpha" type="number" step="0.01" min="0" max="1" class="w-full mt-1 p-1 border rounded" />
        </label>
        <label class="block text-sm mt-2">ㅤ3. Annex threshold min. (%)
          <input v-model.number="params.t_annex_mn" type="number" step="0.001" min="0" max="1" class="w-full mt-1 p-1 border rounded" />
        </label>
        <label class="block text-sm mt-2">ㅤ4. Annex threshold max. (%)
          <input v-model.number="params.t_annex_mx" type="number" step="0.01" min="0" max="1" class="w-full mt-1 p-1 border rounded" />
        </label>
        <label class="block text-sm mt-2">ㅤ5. Small-party cutoff (%)
          <input v-model.number="params.small_cutoff" type="number" step="0.01" min="0" max="1" class="w-full mt-1 p-1 border rounded" />
        </label>
        <label class="block text-sm mt-2">ㅤ6. Small party boost (%)
          <input v-model.number="params.b" type="number" step="0.01" min="0" max="1" class="w-full mt-1 p-1 border rounded" />
        </label>
      </div>

      <!-- Global Settings Panel -->
      <div class="p-3 border rounded">
        <h2 class="font-semibold mb-2">Global</h2>
        <label class="block text-sm">Total voter turnout (auto-calculated from table)
          <input :value="totalVotes" type="number" readonly class="w-full mt-1 p-1 border rounded bg-gray-100" />
        </label>
        <label class="block text-sm mt-2">ㅤRounding mode
          <select v-model="global.roundMode" class="w-full mt-1 p-1 border rounded">
            <option value="nearest">Nearest (.5 to even)</option>
            <option value="ceil">Ceil</option>
            <option value="floor">Floor</option>
          </select>
        </label>

        <div class="mt-4">
          <button @click="runSimulation" class="px-3 py-2 bg-blue-600 text-white rounded disabled:bg-gray-400" :disabled="!isValidInput">Run</button>
          ㅤ
          <button @click="resetSample" class="ml-2 px-3 py-2 border rounded">Reset to sample data</button>
        </div>
      </div>
    </div>

    <!-- Parties Table -->
    <div class="mb-4">
      <h2 class="font-semibold mb-2">Parties</h2>
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="text-left border-b">
            <th></th>
            <th>Name</th>
            <th>Votes (raw)</th>
            <th>Deliberative Seats</th>
            <th>Eligible for Annex?</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="party-tbody">
          <tr v-for="(p, idx) in parties" :key="p.code" class="border-b">
            <td class="text-center drag-handle" style="width:34px;">⋮⋮</td>
            <td class="py-2">
              <input v-model="p.name" class="p-1 border rounded w-full" placeholder="Party name" />
            </td>
            <td>
              <input v-model.number="p.votes" type="number" min="0" class="p-1 border rounded w-full" />
            </td>
            <td>
              <input v-model.number="p.d" type="number" min="0" class="p-1 border rounded w-full" />
            </td>
            <td>
              <input type="checkbox" v-model="p.inAnnex" />
            </td>
            <td class="text-right">
              <button @click="removeParty(idx)" class="text-red-600">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="mt-2">
        <button @click="addParty" class="px-2 py-1 border rounded">Add party</button>
      </div>
    </div>

    <!-- Results Section -->
    <div v-if="resultReady">
      <h2 class="text-lg font-semibold mb-2">Results</h2>
      <div class="overflow-auto border rounded p-2">
        <table class="w-full text-sm border-collapse">
          <thead>
            <tr class="text-left border-b">
              <th>Party</th>
              <th>Votes</th>
              <th>%</th>
              <th>Seats*</th>
              <th>Entitlement</th>
              <th>Baseline Deficit</th>
              <th>Boost</th>
              <th>Augment.</th>
              <th>Annex Seats*</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in resultTable" :key="row.code" class="border-b hover:bg-gray-50">
              <td>{{ row.name }}</td>
              <td>{{ formatInt(row.v) }}</td>
              <td>{{ (row.p * 100).toFixed(2) }}%</td>
              <td>{{ row.d }}</td>
              <td>{{ row.e }}</td>
              <td>{{ row.baseline }}</td>
              <td>{{ row.boost.toFixed(3) }}</td>
              <td>{{ row.aug.toFixed(3) }}</td>
              <td>{{ row.a }}</td>
              <td>{{ row.total }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mb-4 text-sm text-gray-700">
        ㅤㅤㅤ
      </p>
      <p class="mb-4 text-sm text-gray-700">
        <strong>*Seats</strong> = Voting seats/MPs 
      </p>
      <p class="mb-4 text-sm text-gray-700">
        <strong>*Annex Seats</strong> = Non-Voting seats/MPs in annex
      </p>
      <p class="mb-4 text-sm text-gray-700">
        ㅤㅤㅤ
      </p>
    </div>
  </div>
  `
}

createApp(App).mount('#app')

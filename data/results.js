// Sample pre-computed dataset.
// Replace this file later with your real experiment dataset.
// The playground itself does not calculate RL results.

window.GREEN_RL_DATA = {
  runs: [
    {
      runId: "QL-001",
      algorithm: "Q-Learning",
      instance: "TSP-demo-A",
      problemSize: 8,
      seed: 42,
      learningRate: 0.10,
      gamma: 0.90,
      epsilon: 1.00,
      patience: 4,
      summary: {
        bestDistance: 214,
        bestEpisode: 17,
        totalEnergyJ: 12.84,
        totalTimeS: 1.82
      },
      cities: [
        { id: 0, x: 80, y: 70 }, { id: 1, x: 190, y: 120 },
        { id: 2, x: 330, y: 70 }, { id: 3, x: 470, y: 150 },
        { id: 4, x: 420, y: 280 }, { id: 5, x: 260, y: 320 },
        { id: 6, x: 120, y: 260 }, { id: 7, x: 70, y: 160 }
      ],
      bestRoute: [0, 1, 2, 3, 4, 5, 6, 7, 0],
      episodes: [
        {episode:1,reward:-410,distance:410,energy:0.92,time:0.15,epsilon:1.000,converged:false,route:[0,3,1,6,2,7,4,5,0]},
        {episode:2,reward:-386,distance:386,energy:0.88,time:0.14,epsilon:0.995,converged:false,route:[0,1,6,3,2,5,7,4,0]},
        {episode:3,reward:-360,distance:360,energy:0.84,time:0.14,epsilon:0.990,converged:false,route:[0,2,1,7,3,5,4,6,0]},
        {episode:4,reward:-344,distance:344,energy:0.82,time:0.13,epsilon:0.985,converged:false,route:[0,1,7,2,3,6,5,4,0]},
        {episode:5,reward:-330,distance:330,energy:0.79,time:0.12,epsilon:0.980,converged:false,route:[0,2,7,1,3,4,5,6,0]},
        {episode:6,reward:-315,distance:315,energy:0.76,time:0.12,epsilon:0.975,converged:false,route:[0,1,2,4,3,5,7,6,0]},
        {episode:7,reward:-304,distance:304,energy:0.73,time:0.11,epsilon:0.970,converged:false,route:[0,1,3,2,4,5,6,7,0]},
        {episode:8,reward:-291,distance:291,energy:0.70,time:0.11,epsilon:0.966,converged:false,route:[0,2,1,3,4,6,5,7,0]},
        {episode:9,reward:-278,distance:278,energy:0.67,time:0.10,epsilon:0.961,converged:false,route:[0,1,2,5,4,3,7,6,0]},
        {episode:10,reward:-265,distance:265,energy:0.64,time:0.10,epsilon:0.956,converged:false,route:[0,1,2,3,5,4,6,7,0]},
        {episode:11,reward:-254,distance:254,energy:0.61,time:0.09,epsilon:0.951,converged:false,route:[0,1,2,3,4,6,5,7,0]},
        {episode:12,reward:-243,distance:243,energy:0.59,time:0.09,epsilon:0.946,converged:false,route:[0,1,2,3,4,5,7,6,0]},
        {episode:13,reward:-232,distance:232,energy:0.58,time:0.09,epsilon:0.942,converged:false,route:[0,1,2,3,5,4,7,6,0]},
        {episode:14,reward:-224,distance:224,energy:0.57,time:0.09,epsilon:0.937,converged:false,route:[0,1,2,3,4,5,6,7,0]},
        {episode:15,reward:-219,distance:219,energy:0.56,time:0.08,epsilon:0.932,converged:false,route:[0,1,3,2,4,5,6,7,0]},
        {episode:16,reward:-216,distance:216,energy:0.56,time:0.08,epsilon:0.928,converged:false,route:[0,1,2,3,4,6,5,7,0]},
        {episode:17,reward:-214,distance:214,energy:0.55,time:0.08,epsilon:0.923,converged:true,route:[0,1,2,3,4,5,6,7,0]},
        {episode:18,reward:-214,distance:214,energy:0.54,time:0.08,epsilon:0.919,converged:true,route:[0,1,2,3,4,5,6,7,0]},
        {episode:19,reward:-216,distance:216,energy:0.53,time:0.08,epsilon:0.914,converged:true,route:[0,2,1,3,4,5,6,7,0]},
        {episode:20,reward:-214,distance:214,energy:0.53,time:0.08,epsilon:0.910,converged:true,route:[0,1,2,3,4,5,6,7,0]}
      ]
    },
    {
      runId: "QL-002",
      algorithm: "Q-Learning",
      instance: "TSP-demo-B",
      problemSize: 8,
      seed: 7,
      learningRate: 0.05,
      gamma: 0.95,
      epsilon: 1.00,
      patience: 50,
      summary: {
        bestDistance: 228,
        bestEpisode: 19,
        totalEnergyJ: 13.91,
        totalTimeS: 2.04
      },
      cities: [
        { id: 0, x: 90, y: 90 }, { id: 1, x: 210, y: 60 },
        { id: 2, x: 350, y: 110 }, { id: 3, x: 470, y: 75 },
        { id: 4, x: 430, y: 290 }, { id: 5, x: 280, y: 330 },
        { id: 6, x: 130, y: 285 }, { id: 7, x: 75, y: 180 }
      ],
      bestRoute: [0, 1, 2, 3, 4, 5, 6, 7, 0],
      episodes: [
        {episode:1,reward:-430,distance:430,energy:0.98,time:0.16,epsilon:1.000,converged:false,route:[0,4,1,6,3,7,2,5,0]},
        {episode:2,reward:-410,distance:410,energy:0.94,time:0.15,epsilon:0.995,converged:false,route:[0,2,7,4,1,6,3,5,0]},
        {episode:3,reward:-392,distance:392,energy:0.90,time:0.15,epsilon:0.990,converged:false,route:[0,1,7,2,3,5,4,6,0]},
        {episode:4,reward:-374,distance:374,energy:0.87,time:0.14,epsilon:0.985,converged:false,route:[0,2,1,7,3,4,5,6,0]},
        {episode:5,reward:-358,distance:358,energy:0.84,time:0.13,epsilon:0.980,converged:false,route:[0,1,2,7,3,4,6,5,0]},
        {episode:6,reward:-341,distance:341,energy:0.81,time:0.12,epsilon:0.975,converged:false,route:[0,1,2,3,5,4,7,6,0]},
        {episode:7,reward:-329,distance:329,energy:0.78,time:0.12,epsilon:0.970,converged:false,route:[0,1,3,2,4,5,7,6,0]},
        {episode:8,reward:-318,distance:318,energy:0.75,time:0.11,epsilon:0.966,converged:false,route:[0,2,1,3,4,6,5,7,0]},
        {episode:9,reward:-302,distance:302,energy:0.72,time:0.11,epsilon:0.961,converged:false,route:[0,1,2,4,3,5,7,6,0]},
        {episode:10,reward:-291,distance:291,energy:0.69,time:0.10,epsilon:0.956,converged:false,route:[0,1,2,3,4,7,5,6,0]},
        {episode:11,reward:-278,distance:278,energy:0.66,time:0.10,epsilon:0.951,converged:false,route:[0,1,2,3,5,4,6,7,0]},
        {episode:12,reward:-269,distance:269,energy:0.64,time:0.10,epsilon:0.946,converged:false,route:[0,1,2,3,4,6,5,7,0]},
        {episode:13,reward:-260,distance:260,energy:0.63,time:0.09,epsilon:0.942,converged:false,route:[0,1,3,2,4,5,6,7,0]},
        {episode:14,reward:-248,distance:248,energy:0.61,time:0.09,epsilon:0.937,converged:false,route:[0,1,2,3,5,4,7,6,0]},
        {episode:15,reward:-239,distance:239,energy:0.60,time:0.09,epsilon:0.932,converged:false,route:[0,1,2,3,4,5,7,6,0]},
        {episode:16,reward:-233,distance:233,energy:0.59,time:0.09,epsilon:0.928,converged:false,route:[0,1,2,3,4,5,6,7,0]},
        {episode:17,reward:-231,distance:231,energy:0.58,time:0.09,epsilon:0.923,converged:false,route:[0,1,2,3,5,4,6,7,0]},
        {episode:18,reward:-229,distance:229,energy:0.58,time:0.09,epsilon:0.919,converged:false,route:[0,1,2,3,4,5,6,7,0]},
        {episode:19,reward:-228,distance:228,energy:0.57,time:0.09,epsilon:0.914,converged:true,route:[0,1,2,3,4,5,6,7,0]},
        {episode:20,reward:-228,distance:228,energy:0.57,time:0.09,epsilon:0.910,converged:true,route:[0,1,2,3,4,5,6,7,0]}
      ]
    }
  ]
};

console.log("Worker started");

postMessage("hola soy el worker, me desperte");

// for (let i = 0; i < 999; i++) {
//   console.log("worker", i);
// }
// const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

let counter = 0;

function gameLoop() {
  counter++;
  if (counter == 100) return;
  console.log("worker", counter);

  requestAnimationFrame(gameLoop);
}

self.addEventListener("message", (event) => {
  console.log("Data received from main thread:", event);

  // // Process the data...
  // const result = performHeavyCalculation(event.data);

  // // 2. Send a response back to the main thread
  // self.postMessage(result);
});

gameLoop();

class MinHeap {
  constructor(compareFunc = (a, b) => a.time - b.time) {
    this.data = [];
    this.compare = compareFunc;
  }

  push(val) {
    this.data.push(val);
    this._bubbleUp(this.data.length - 1);
  }

  pop() {
    if (this.data.length === 0) return null;
    const top = this.data[0];
    const bottom = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = bottom;
      this._bubbleDown(0);
    }
    return top;
  }
  
  peek() {
    return this.data.length > 0 ? this.data[0] : null;
  }

  size() {
    return this.data.length;
  }

  _bubbleUp(index) {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.compare(this.data[index], this.data[parentIndex]) >= 0) break;
      this._swap(index, parentIndex);
      index = parentIndex;
    }
  }

  _bubbleDown(index) {
    const length = this.data.length;
    while (true) {
      let left = index * 2 + 1;
      let right = index * 2 + 2;
      let smallest = index;

      if (left < length && this.compare(this.data[left], this.data[smallest]) < 0) smallest = left;
      if (right < length && this.compare(this.data[right], this.data[smallest]) < 0) smallest = right;
      
      if (smallest === index) break;
      this._swap(index, smallest);
      index = smallest;
    }
  }

  _swap(i, j) {
    const temp = this.data[i];
    this.data[i] = this.data[j];
    this.data[j] = temp;
  }
}
window.MinHeap = MinHeap;

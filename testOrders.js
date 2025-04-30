const { placeOrder } = require('./shared/placeOrders');

// Example: Buy 10 shares of AAPL as a market order
placeOrder('AAPL', 10, 'buy', 'market', 'day')
  .then(order => {
    console.log('Order confirmed:', order.id);
  })
  .catch(err => {
    console.error('Order error:', err.message);
  });
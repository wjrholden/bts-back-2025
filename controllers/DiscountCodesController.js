'use strict';

class DiscountCodesController {
  discountCodesData;
  reservationsData;

  constructor({discountCodesData, reservationsData}) {
    this.discountCodesData = discountCodesData;
    this.reservationsData = reservationsData;
  }

  async applyDiscountCode({
    discountCode,
    totalPrice,
    ticketQuantity,
    eventId,
  }) {
    if (!discountCode || !totalPrice || !ticketQuantity || !eventId) {
      return {
        status: 400,
        message: 'Invalid request',
      };
    }

    const discountCodeObj = await this.discountCodesData.getDiscountCode(discountCode);

    if (!discountCodeObj) {
      return {
        status: 400,
        message: 'Discount code not found',
      };
    }

    const discountCodeEventObj = await this.discountCodesData.getDiscountCodeEvent(discountCodeObj.id, eventId);

    if (Date.parse(discountCodeObj.expiresOn) < Date.now()) {
      return {
        status: 200,
        message: 'Discount code expired',
      };
    }

    // Type 1 = reusable discount codes (x times per event)
    if (discountCodeObj.type === 1
        && discountCodeEventObj
        && discountCodeEventObj.timesUsedThisEvent >= discountCodeObj.usesPerEvent) {
      return {
        status: 200,
        message: 'Discount code has already been used up for this event',
      };
    }

    // Type 2 = single-use discount codes
    if (discountCodeObj.type === 2 && discountCodeObj.remainingUses < 1) {
      return {
        status: 200,
        message: 'Discount code has no uses remaining',
      };
    }

    // how many tickets in this order can be discounted?
    let usesAllowedThisOrder;

    if (discountCodeObj.type === 1) { // reusable
      const previousUsesThisEvent = discountCodeEventObj ? discountCodeEventObj.timesUsedThisEvent : 0;
      usesAllowedThisOrder = Math.min(discountCodeObj.usesPerEvent - previousUsesThisEvent, ticketQuantity);
    } else if (discountCodeObj.type === 2) { // single-use
      usesAllowedThisOrder = Math.min(discountCodeObj.remainingUses, ticketQuantity);
    }

    // update relevant DB fields
    let usesRemainingAfterThisOrder = 0; // keep remainingUses = 0 for type 1 discount codes
    let eventTableUsesPerEvent = discountCodeObj.usesPerEvent;

    if (discountCodeObj.type === 2) {
      usesRemainingAfterThisOrder = discountCodeObj.remainingUses - usesAllowedThisOrder;
      // in order to properly release type 2 discount codes we need to track the initial/starting/creation `remainingUses` value
      eventTableUsesPerEvent = Math.max(discountCodeObj.remainingUses, discountCodeEventObj ? discountCodeEventObj.usesPerEvent : 0);
    }

    const sumAllTimesUsedThisCode = discountCodeObj.timesUsed + usesAllowedThisOrder;
    let sumAllTimesUsedThisEvent = usesAllowedThisOrder;

    if (discountCodeEventObj) { // if there is a previous usage of this discount code for this event, add to the sum
      sumAllTimesUsedThisEvent = discountCodeEventObj.timesUsedThisEvent + usesAllowedThisOrder;
    }

    await this.discountCodesData.useDiscountCode(discountCode, usesRemainingAfterThisOrder, sumAllTimesUsedThisCode);

    if (!discountCodeEventObj) {
      await this.discountCodesData.addDiscountCodeEvent(discountCodeObj.id, eventId, sumAllTimesUsedThisEvent, eventTableUsesPerEvent);
    } else {
      await this.discountCodesData.useDiscountCodeEvent(discountCodeObj.id, eventId, sumAllTimesUsedThisEvent, eventTableUsesPerEvent);
    }

    const pricePerTicket = totalPrice / ticketQuantity;
    const savingsPerTicket = pricePerTicket * (discountCodeObj.percentage / 100);
    const totalSavings = this.formatCurrency(savingsPerTicket * usesAllowedThisOrder);
    const totalPriceAfterDiscount = this.formatCurrency(totalPrice - totalSavings);

    return {
      status: 200,
      discountCodeId: discountCodeObj.id,
      totalSavings,
      totalPriceAfterDiscount,
    };
  }

  async releaseDiscountCode({
    discountCode,
    eventId,
  }) {
    if (!discountCode || !eventId) {
      return {
        status: 400,
        message: 'Invalid request',
      };
    }

    const discountCodeObj = await this.discountCodesData.getDiscountCode(discountCode);
    const discountCodeEventObj = await this.discountCodesData.getDiscountCodeEvent(discountCodeObj.id, eventId);

    if (!discountCodeObj || !discountCodeEventObj) {
      return {
        status: 400,
        message: 'Discount code not found',
      };
    }

    let reservationsUsingThisDiscount;

    if (discountCodeObj.type === 2) {
      // discountCodeObj.remainingUses can't be the trusted source of truth for type 2 discount codes
      // so that's why capture the initial/starting/creation `remainingUses` value in the discount_codes_events table
      reservationsUsingThisDiscount = await this.reservationsData.getReservationsByDiscountCodeId(discountCodeObj.id);
    } else if (discountCodeObj.type === 1) {
      reservationsUsingThisDiscount = await this.reservationsData.getReservationsByDiscountByEventThroughPickupParties(discountCodeObj.id, eventId);
    }

    const discountCodeIsReleasable = discountCodeEventObj.usesPerEvent > reservationsUsingThisDiscount.rowCount;
    const countOfReleaseableDiscountCodes = discountCodeEventObj.timesUsedThisEvent - reservationsUsingThisDiscount.rowCount;

    if (!discountCodeIsReleasable) {
      return {
        status: 200,
        message: 'Discount code has already been depleted',
      };
    }

    // release the discount code
    let postReleaseRemainingUses = 0;

    if (discountCodeObj.type === 2) {
      postReleaseRemainingUses = discountCodeObj.remainingUses + countOfReleaseableDiscountCodes;
    }

    const decrementedTimesUsed = discountCodeObj.timesUsed - countOfReleaseableDiscountCodes;
    const decrementedTimesUsedThisEvent = discountCodeEventObj.timesUsedThisEvent - countOfReleaseableDiscountCodes;
    await this.discountCodesData.releaseDiscountCode(discountCode, postReleaseRemainingUses, decrementedTimesUsed);
    await this.discountCodesData.releaseDiscountCodeEvent(discountCodeObj.id, eventId, decrementedTimesUsedThisEvent);

    return {
      status: 200,
      message: 'Discount code released',
    };
  }

  formatCurrency(amount) {
    // e.g. 0 -> '0.00', 1.005 => '1.01'
    return amount.toLocaleString('en-US', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    });
  }
}

module.exports = DiscountCodesController;

/*!
 * jQuery Vertical Carousel
 * https://github.com/haripaddu/jQuery-Vertical-Carousel
 * Version: 1.0
 * License: MIT
 */

(function(jQuery) {  
	jQuery.fn.verticalCarousel = function(options) {  

		var carouselContainerClass = "vc_container";
		var carouselGroupClass = "vc_list";
		var carouselGoUpClass = "vc_goUp";
		var carouselGoDownClass = "vc_goDown";
  
		var defaults = { currentItem: 1, showItems: 1, showItems: 1 };
		var options = jQuery.extend(defaults, options);

		var carouselContainer;
		var carouselGroup;
		var carouselUp;
		var carouselDown;
		var totalItems;

		var setContainerHeight = (function(){
			var containerHeight = 0;
			var marginTop = 0;
			if (options.showItems == 1){
				containerHeight = jQuery("> :nth-child(" + options.currentItem + ")", carouselGroup).outerHeight(true);
			}
			else{
				for (i = 1; i <= options.showItems; i++) {
				    containerHeight = containerHeight + jQuery("> :nth-child(" + i + ")", carouselGroup).outerHeight(true);
				}
			}
			var nextItem = options.showItems + options.currentItem;
			marginTop = jQuery("> :nth-child(" + nextItem + ")", carouselGroup).css("marginTop");
			containerHeight = containerHeight - parseInt(marginTop);
			jQuery(carouselContainer).css("height", containerHeight);
		});

		var setHeight = (function(this_el){
			console.log(this_el);
			jQuery('li', carouselGroup).css('height', this_el.height()/options.showItems);
		});

		var setOffset = (function(){
			var currentItemOffset = jQuery("> :nth-child(" + options.currentItem + ")", carouselGroup).offset();
			var carouselGroupOffset = jQuery(carouselGroup).offset();
			var offsetDiff = carouselGroupOffset.top - currentItemOffset.top;
			jQuery(carouselGroup).css({
				"-ms-transform": "translateY(" + offsetDiff + "px)",
				"-webkit-transform": "translateY(" + offsetDiff + "px)",
				"transform": "translateY(" + offsetDiff + "px)"
			})
		});

		var updateNavigation = (function(direction){
			if (options.currentItem == 1){
				jQuery(carouselUp).addClass("isDisabled");
			}
			else if (options.currentItem > 1){
				jQuery(carouselUp).removeClass("isDisabled");
			}
			if(options.currentItem == totalItems || options.currentItem + options.showItems > totalItems){
				jQuery(carouselDown).addClass("isDisabled");
			}
			else if (options.currentItem < totalItems){
				jQuery(carouselDown).removeClass("isDisabled");
			}
		});

		var moveCarousel = (function(direction){
			if (direction == "up"){
				options.currentItem = options.currentItem - 1;
			}
			if (direction == "down"){
				options.currentItem = options.currentItem + 1;
			}
			updateNavigation();
			setContainerHeight();
			setOffset();
		});
		
		return this.each(function() {
			var this_el = jQuery(this);
			this_el.find("." + carouselGroupClass).wrap('<div class="' + carouselContainerClass + '"></div>');
			carouselContainer = this_el.find("." + carouselContainerClass);
			carouselGroup = this_el.find("." + carouselGroupClass);
			carouselUp = this_el.find("." + carouselGoUpClass);
			carouselDown = this_el.find("." + carouselGoDownClass);
			totalItems = jQuery(carouselGroup).children().length;

			jQuery(window).on('resize', function() {
				setHeight(this_el);
				setContainerHeight();
				setOffset();
			});

			updateNavigation();
			jQuery(carouselUp).on("click", function(e){
				if (options.currentItem > 1){
					moveCarousel("up");
				}
				e.preventDefault();
			});
			jQuery(carouselDown).on("click", function(e){
				if (options.currentItem + options.showItems <= totalItems){
					moveCarousel("down");
				}
				e.preventDefault();
			});
		});

	};  
})(jQuery);